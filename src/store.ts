import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { stowageApi, type Cargo, type CargoType } from './api';

export type StowageComment = {
  id: string;
  cargoId: string;
  author: string;
  role: '船长' | '码头' | '货主';
  content: string;
  status: '待确认' | '已接受' | '已退回';
};

export type TerminalId = 'shore' | 'ship';

export type ChangeKind = 'cargo' | 'lashing' | 'hazmat' | 'deckLoad';

export type OfflineChange = {
  id: string;
  kind: ChangeKind;
  cargoId: string;
  bill: string;
  at: string;
  summary: string;
  payload: Record<string, number | string>;
};

export type PendingBatch = {
  id: string;
  source: TerminalId;
  submittedAt: string;
  changes: OfflineChange[];
  status: '待处理' | '已合并' | '已驳回';
  reason: 'race-lost' | 'locked' | 'manual';
};

export type BearingOver = { id: string; allowable: number; weight: number };

export type ReleaseConclusions = {
  computedAt: string;
  total: number;
  longitudinal: number;
  vertical: number;
  deckLoad: number;
  stability: number;
  trim: string;
  conflicts: { id: string; cargoId: string; level: 'high' | 'medium'; title: string; detail: string }[];
  missingBearing: string[];
  bearingOver: BearingOver[];
  pass: boolean;
};

export type ReleaseState = {
  status: '草稿' | '已放行';
  releasedAt: string | null;
  conclusions: ReleaseConclusions | null;
  writeStatus: 'idle' | '写入中' | '失败' | '成功';
  writeError: string | null;
  retryBill: string | null;
  localBatch: OfflineChange[];
  attempts: number;
};

type State = {
  cargo: Cargo[];
  activeCargoId: string;
  planRevision: number;
  comments: StowageComment[];
  acceptedLimits: string[];
  locked: boolean;
  viewMode: '3d' | 'section';
  draftSavedAt: string;
  offline: boolean;
  activeTerminal: TerminalId;
  outbox: Record<TerminalId, OfflineChange[]>;
  pendingBatches: PendingBatch[];
  deckLoad: Record<string, number>;
  changesSinceRelease: OfflineChange[];
  release: ReleaseState;
};

const initialCargo: Cargo[] = [
  { id: 'BL-88214', bill: 'SEA-88214', type: '集装箱', bay: 12, row: 4, tier: 2, deck: '主甲板', weight: 24.6, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '已绑扎', color: '#2b7c75' },
  { id: 'BL-88219', bill: 'SEA-88219', type: '集装箱', bay: 13, row: 4, tier: 2, deck: '主甲板', weight: 28.1, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: 'UN 1263', lashing: '需复核', color: '#c77835' },
  { id: 'BL-88231', bill: 'SEA-88231', type: '集装箱', bay: 10, row: 6, tier: 1, deck: '主甲板', weight: 18.2, dimension: '20 × 8 × 8.6 ft', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#366d94' },
  { id: 'BL-88240', bill: 'SEA-88240', type: '集装箱', bay: 8, row: 2, tier: 2, deck: '货舱', weight: 31.4, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '待绑扎', color: '#6d528d' },
  { id: 'BL-88247', bill: 'SEA-88247', type: '重大件', bay: 15, row: 0, tier: 1, deck: '主甲板', weight: 112.5, dimension: '18.4 × 4.2 × 4.8 m', port: '温哥华', hazmat: '无', lashing: '需复核', color: '#b64f49' },
  { id: 'BL-88254', bill: 'SEA-88254', type: '散货', bay: 5, row: 0, tier: 0, deck: '货舱', weight: 286.0, dimension: '散装 / 420 m³', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#9a7836' }
];

const now = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
const uid = () => `CH-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

function describeChange(kind: ChangeKind, payload: Record<string, number | string>) {
  if (kind === 'cargo') return `货位调整 → Bay ${payload.bay} / Row ${payload.row} / Tier ${payload.tier}`;
  if (kind === 'lashing') return `绑扎状态 → ${payload.lashing}`;
  if (kind === 'hazmat') return `危险品 → ${payload.hazmat}`;
  return `舱盖板承重 → ${payload.deckLoad} t/m²`;
}

// 由尺寸字符串计算占地面积（m²），尺寸为 ft 时换算为 m。
export function footprint(item: Cargo): number {
  const match = item.dimension.match(/([\d.]+)\s*[×xX*]\s*([\d.]+)/);
  if (!match) return 28;
  const a = parseFloat(match[1]);
  const b = parseFloat(match[2]);
  const factor = /ft/i.test(item.dimension) ? 0.3048 : 1;
  return a * b * factor * factor;
}

export function buildConclusions(cargo: Cargo[], deckLoad: Record<string, number>): ReleaseConclusions {
  const stability = calculateStability(cargo);
  const conflicts = detectConflicts(cargo);
  const missingBearing: string[] = [];
  const bearingOver: BearingOver[] = [];
  cargo.forEach((item) => {
    if (item.deck !== '主甲板') return;
    const allowable = deckLoad[item.id];
    if (allowable == null) {
      missingBearing.push(item.id);
      return;
    }
    const area = footprint(item);
    if (allowable * area < item.weight) {
      bearingOver.push({ id: item.id, allowable: +(allowable * area).toFixed(1), weight: item.weight });
    }
  });
  return {
    computedAt: now(),
    ...stability,
    conflicts,
    missingBearing,
    bearingOver,
    pass: conflicts.length === 0 && missingBearing.length === 0 && bearingOver.length === 0
  };
}

const baseState: State = {
  cargo: initialCargo,
  activeCargoId: 'BL-88247',
  planRevision: 5,
  comments: [
    { id: 'CM-21', cargoId: 'BL-88219', author: '港方配载', role: '码头', content: '危险品箱与船员生活区保持隔离，请在最终图中标注危险品隔离线。', status: '待确认' },
    { id: 'CM-22', cargoId: 'BL-88247', author: '周船长', role: '船长', content: '重大件横向支撑需增加两组绑扎点，检查甲板局部强度。', status: '待确认' },
    { id: 'CM-23', cargoId: 'BL-88254', author: '货主代表', role: '货主', content: '釜山港卸货前不得覆盖散货舱口，已接受当前安排。', status: '已接受' }
  ],
  acceptedLimits: [],
  locked: false,
  viewMode: '3d',
  draftSavedAt: '09:52',
  offline: false,
  activeTerminal: 'shore',
  outbox: { shore: [], ship: [] },
  pendingBatches: [],
  deckLoad: {},
  changesSinceRelease: [],
  release: {
    status: '草稿',
    releasedAt: null,
    conclusions: null,
    writeStatus: 'idle',
    writeError: null,
    retryBill: null,
    localBatch: [],
    attempts: 0
  }
};

const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('yy62-stowage-plan') : null;
const saved = raw ? JSON.parse(raw) : null;
const initialState: State = saved
  ? {
      ...baseState,
      ...saved,
      outbox: saved.outbox ?? baseState.outbox,
      pendingBatches: saved.pendingBatches ?? [],
      deckLoad: saved.deckLoad ?? {},
      changesSinceRelease: saved.changesSinceRelease ?? [],
      release: { ...baseState.release, ...(saved.release ?? {}) }
    }
  : baseState;

// 应用一条改动到当前方案，并追加到放行批次、重算结论。
function commitChange(state: State, change: OfflineChange) {
  const cargo = state.cargo.find((item) => item.id === change.cargoId);
  if (!cargo) return;
  if (change.kind === 'cargo') Object.assign(cargo, change.payload);
  else if (change.kind === 'lashing') cargo.lashing = change.payload.lashing as Cargo['lashing'];
  else if (change.kind === 'hazmat') cargo.hazmat = String(change.payload.hazmat);
  else if (change.kind === 'deckLoad') state.deckLoad[change.cargoId] = Number(change.payload.deckLoad);
  state.changesSinceRelease.push({ ...change, id: uid(), at: now() });
  recompute(state);
}

function recompute(state: State) {
  state.planRevision += 1;
  state.release.conclusions = buildConclusions(state.cargo, state.deckLoad);
  state.draftSavedAt = now();
}

const slice = createSlice({
  name: 'stowage',
  initialState,
  reducers: {
    selectCargo(state, action: PayloadAction<string>) { state.activeCargoId = action.payload; },
    // 在线且未锁定：直接应用货位改动；离线或已锁定：进入当前终端的待发件箱。
    moveCargo(state, action: PayloadAction<{ id: string; bay: number; row: number; tier: number }>) {
      const cargo = state.cargo.find((item) => item.id === action.payload.id);
      if (!cargo) return;
      if (state.offline || state.locked) {
        state.outbox[state.activeTerminal].push({
          id: uid(), kind: 'cargo', cargoId: cargo.id, bill: cargo.bill, at: now(),
          summary: describeChange('cargo', action.payload), payload: { ...action.payload }
        });
        state.draftSavedAt = now();
      } else {
        commitChange(state, {
          id: uid(), kind: 'cargo', cargoId: cargo.id, bill: cargo.bill, at: now(),
          summary: describeChange('cargo', action.payload), payload: { ...action.payload }
        });
      }
    },
    updateLashing(state, action: PayloadAction<{ id: string; lashing: Cargo['lashing'] }>) {
      const cargo = state.cargo.find((item) => item.id === action.payload.id);
      if (!cargo) return;
      if (state.offline || state.locked) {
        state.outbox[state.activeTerminal].push({
          id: uid(), kind: 'lashing', cargoId: cargo.id, bill: cargo.bill, at: now(),
          summary: describeChange('lashing', { lashing: action.payload.lashing }), payload: { lashing: action.payload.lashing }
        });
        state.draftSavedAt = now();
      } else {
        commitChange(state, {
          id: uid(), kind: 'lashing', cargoId: cargo.id, bill: cargo.bill, at: now(),
          summary: describeChange('lashing', { lashing: action.payload.lashing }), payload: { lashing: action.payload.lashing }
        });
      }
    },
    addComment(state, action: PayloadAction<{ cargoId: string; author: string; role: StowageComment['role']; content: string }>) {
      state.comments.unshift({ ...action.payload, id: `CM-${Date.now()}`, status: '待确认' });
    },
    acceptComment(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload);
      if (comment) comment.status = '已接受';
    },
    rejectComment(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload);
      if (comment) comment.status = '已退回';
    },
    acceptLimit(state, action: PayloadAction<string>) {
      if (!state.acceptedLimits.includes(action.payload)) state.acceptedLimits.push(action.payload);
    },
    setViewMode(state, action: PayloadAction<'3d' | 'section'>) { state.viewMode = action.payload; },
    lockPlan(state) {
      state.locked = true;
      state.planRevision += 1;
      state.release.status = '草稿';
    },
    setOffline(state, action: PayloadAction<boolean>) { state.offline = action.payload; },
    setTerminal(state, action: PayloadAction<TerminalId>) { state.activeTerminal = action.payload; },
    // 离线模式下暂存一版改动（货位 / 绑扎 / 危险品 / 承重），不触碰当前方案。
    stageChange(state, action: PayloadAction<{ kind: ChangeKind; cargoId: string; payload: Record<string, number | string> }>) {
      const cargo = state.cargo.find((item) => item.id === action.payload.cargoId);
      if (!cargo) return;
      state.outbox[state.activeTerminal].push({
        id: uid(),
        kind: action.payload.kind,
        cargoId: cargo.id,
        bill: cargo.bill,
        at: now(),
        summary: describeChange(action.payload.kind, action.payload.payload),
        payload: action.payload.payload
      });
      state.draftSavedAt = now();
    },
    // 单个终端回网提交：方案未锁定则合并，已锁定则整批进入待处理，不覆盖锁定快照。
    submitBatch(state, action: PayloadAction<{ source: TerminalId }>) {
      const changes = state.outbox[action.payload.source];
      if (!changes.length) return;
      const batch: PendingBatch = {
        id: `B-${Date.now()}`,
        source: action.payload.source,
        submittedAt: now(),
        changes: changes.map((change) => ({ ...change })),
        status: '待处理',
        reason: state.locked ? 'locked' : 'manual'
      };
      state.outbox[action.payload.source] = [];
      if (state.locked) {
        state.pendingBatches.unshift(batch);
        return;
      }
      batch.changes.forEach((change) => commitChange(state, change));
      batch.status = '已合并';
      state.pendingBatches.unshift(batch);
    },
    // 两个终端同时提交：先确认的一版合并保留，另一版进入待处理（竞态落败）。
    raceSubmit(state) {
      const sources: TerminalId[] = ['shore', 'ship'];
      let merged = false;
      if (state.locked) {
        sources.forEach((source) => {
          const changes = state.outbox[source];
          if (!changes.length) return;
          state.pendingBatches.unshift({
            id: uid(), source, submittedAt: now(),
            changes: changes.map((change) => ({ ...change })),
            status: '待处理', reason: 'locked'
          });
          state.outbox[source] = [];
        });
        return;
      }
      sources.forEach((source) => {
        const changes = state.outbox[source];
        if (!changes.length) return;
        const batch: PendingBatch = {
          id: uid(), source, submittedAt: now(),
          changes: changes.map((change) => ({ ...change })),
          status: '待处理', reason: 'race-lost'
        };
        state.outbox[source] = [];
        if (!merged) {
          batch.changes.forEach((change) => commitChange(state, change));
          batch.status = '已合并';
          batch.reason = 'manual';
          merged = true;
        }
        state.pendingBatches.unshift(batch);
      });
    },
    // 手动合并一个待处理批次；方案已锁定时不允许覆盖快照。
    mergeBatch(state, action: PayloadAction<string>) {
      const batch = state.pendingBatches.find((item) => item.id === action.payload);
      if (!batch || batch.status !== '待处理' || state.locked) return;
      batch.changes.forEach((change) => commitChange(state, change));
      batch.status = '已合并';
      batch.reason = 'manual';
    },
    rejectBatch(state, action: PayloadAction<string>) {
      const batch = state.pendingBatches.find((item) => item.id === action.payload);
      if (batch && batch.status === '待处理') batch.status = '已驳回';
    },
    // 补齐旧草稿缺失的舱盖板承重记录；承重补齐后重算结论才能重排。
    fillDeckLoad(state, action: PayloadAction<{ cargoId: string; value: number }>) {
      commitChange(state, {
        id: uid(), kind: 'deckLoad', cargoId: action.payload.cargoId, bill: state.cargo.find((item) => item.id === action.payload.cargoId)?.bill ?? '',
        at: now(), summary: describeChange('deckLoad', { deckLoad: action.payload.value }), payload: { deckLoad: action.payload.value }
      });
    },
    recalcRelease(state) {
      recompute(state);
    },
    releaseSucceeded(state, action: PayloadAction<{ revision: number }>) {
      state.release.status = '已放行';
      state.release.releasedAt = now();
      state.release.writeStatus = '成功';
      state.release.writeError = null;
      state.release.localBatch = [];
      state.release.retryBill = null;
      state.changesSinceRelease = [];
      state.locked = true;
      state.planRevision = action.payload.revision;
    },
    // 放行写入失败：保留本地批次，记录原提单号与失败次数，批次退回终端待发件箱。
    releaseFailed(state, action: PayloadAction<{ error: string; retryBill: string; source: TerminalId }>) {
      state.release.status = '草稿';
      state.release.writeStatus = '失败';
      state.release.writeError = action.payload.error;
      state.release.retryBill = action.payload.retryBill;
      state.release.localBatch = state.changesSinceRelease.map((change) => ({ ...change }));
      state.release.attempts += 1;
      state.outbox[action.payload.source] = state.changesSinceRelease.map((change) => ({ ...change }));
      state.changesSinceRelease = [];
    }
  }
});

export const {
  selectCargo, moveCargo, updateLashing,
  addComment, acceptComment, rejectComment, acceptLimit, setViewMode, lockPlan,
  setOffline, setTerminal, stageChange, submitBatch, raceSubmit, mergeBatch, rejectBatch,
  fillDeckLoad, recalcRelease, releaseSucceeded, releaseFailed
} = slice.actions;

export const store = configureStore({
  reducer: { stowage: slice.reducer, [stowageApi.reducerPath]: stowageApi.reducer },
  middleware: (getDefault) => getDefault().concat(stowageApi.middleware)
});

store.subscribe(() => {
  if (typeof localStorage !== 'undefined') localStorage.setItem('yy62-stowage-plan', JSON.stringify(store.getState().stowage));
});

export type RootState = ReturnType<typeof store.getState>;

export function calculateStability(cargo: Cargo[]) {
  const total = cargo.reduce((sum, item) => sum + item.weight, 0);
  const longitudinal = cargo.reduce((sum, item) => sum + item.weight * item.bay, 0) / Math.max(total, 1);
  const vertical = cargo.reduce((sum, item) => sum + item.weight * (item.tier + 1), 0) / Math.max(total, 1);
  const deckLoad = cargo.filter((item) => item.deck === '主甲板').reduce((sum, item) => sum + item.weight, 0);
  const stability = Math.max(0, 92 - Math.abs(longitudinal - 10.8) * 2.2 - Math.max(0, vertical - 1.75) * 8);
  return {
    total,
    longitudinal,
    vertical,
    deckLoad,
    stability,
    trim: (longitudinal - 10.8) < -0.4 ? '艉倾' : (longitudinal - 10.8) > 0.4 ? '艏倾' : '正平'
  };
}

export function detectConflicts(cargo: Cargo[]) {
  const issues: { id: string; cargoId: string; level: 'high' | 'medium'; title: string; detail: string }[] = [];
  const slots = new Map<string, Cargo>();
  cargo.forEach((item) => {
    const key = `${item.deck}-${item.bay}-${item.row}-${item.tier}`;
    const existing = slots.get(key);
    if (existing) issues.push({ id: `${item.id}-overlap`, cargoId: item.id, level: 'high', title: '货位重叠', detail: `${item.id} 与 ${existing.id} 占用相同二维货位。` });
    slots.set(key, item);
    if (item.hazmat !== '无' && item.deck === '主甲板' && item.row <= 1) issues.push({ id: `${item.id}-hazmat`, cargoId: item.id, level: 'high', title: '危险品隔离不足', detail: `${item.id} 与船体边界距离小于方案要求。` });
    if (item.weight > 100 && item.lashing !== '已绑扎') issues.push({ id: `${item.id}-lashing`, cargoId: item.id, level: 'medium', title: '重大件绑扎未完成', detail: `${item.id} 重量 ${item.weight}t，绑扎状态为“${item.lashing}”。` });
    if (item.type === '集装箱' && item.weight > 30 && item.tier >= 3) issues.push({ id: `${item.id}-stack`, cargoId: item.id, level: 'medium', title: '上层堆重超限', detail: `${item.id} 不应放在第 ${item.tier} 层。` });
  });
  return issues;
}
