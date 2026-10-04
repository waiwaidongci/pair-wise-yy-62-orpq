import {
  configureStore,
  createAsyncThunk,
  createSlice,
  type PayloadAction
} from '@reduxjs/toolkit';
import {
  peekServerLock,
  primeNextWriteFailure,
  resetReleaseServer,
  stowageApi,
  submitReleaseToServer,
  type Cargo,
  type CargoType,
  type HatchCover,
  type LashingStatus,
  type ReleaseAck
} from './api';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type TerminalId = 'shore' | 'ship';
export type DraftStatus = 'draft' | 'submitting' | 'cleared' | 'pending' | 'failed';

export type StowOp =
  | { type: 'stow'; id: string; bay: number; row: number; tier: number; deck?: Cargo['deck'] }
  | { type: 'lashing'; id: string; lashing: LashingStatus; appliedLashPoints: number }
  | { type: 'segregation'; id: string; dgDistance: number }
  | { type: 'hatchLoad'; id: string; hatchId: string; footprintArea: number }
  | { type: 'hatchConfig'; hatchId: string; maxPressure: number; maxTotal: number };

export const opKindLabel: Record<StowOp['type'], string> = {
  stow: '货位',
  lashing: '绑扎',
  segregation: '危险品隔离',
  hatchLoad: '舱盖板承重',
  hatchConfig: '舱盖板承重'
};

export type LocalBatch = {
  id: string;
  kind: 'edit' | 'release';
  terminalId: TerminalId;
  anchorBill: string;
  baseRevision: number;
  ops: StowOp[];
  createdAt: string;
  status: '本地保留' | '已合并' | '失败待重试' | '已提交';
  error?: string;
};

export type PendingReason = '并发落选' | '断网合并' | '锁定后改动';

export type PendingItem = {
  id: string;
  reason: PendingReason;
  sourceTerminal: TerminalId;
  opKind: StowOp['type'] | 'release';
  cargoId: string;
  bill: string;
  title: string;
  detail: string;
  before?: Partial<Cargo> | Partial<HatchCover>;
  after?: Partial<Cargo> | Partial<HatchCover>;
  status: '待处理' | '已接受' | '已退回';
  createdAt: string;
};

export type LockedSnapshot = {
  revision: number;
  winner: TerminalId;
  ackId: string;
  docNo: string;
  lockedAt: string;
  anchorBill: string;
  cargo: Cargo[];
  hatchCovers: HatchCover[];
};

export type TerminalState = {
  id: TerminalId;
  label: string;
  role: string;
  online: boolean;
  revision: number;
  status: DraftStatus;
  anchorBill: string | null;
  ack: ReleaseAck | null;
  lastError: string | null;
};

export type LogEntry = { id: string; time: string; terminalId: TerminalId | 'system'; text: string; kind: StowOp['type'] | 'release' | 'sync' | 'system' };
export type Notice = { id: string; tone: 'info' | 'error' | 'success'; text: string };

type ReleaseState = {
  drafts: Record<TerminalId, Cargo[]>;
  hatchCovers: HatchCover[];
  terminals: Record<TerminalId, TerminalState>;
  activeTerminal: TerminalId;
  planRevision: number;
  verdictComputedAt: string;
  comments: StowageComment[];
  acceptedLimits: string[];
  viewMode: '3d' | 'section';
  activeCargoId: string;
  draftSavedAt: string;
  snapshot: LockedSnapshot | null;
  pending: PendingItem[];
  batches: LocalBatch[];
  inbox: Record<TerminalId, StowOp[]>;
  logs: LogEntry[];
  notices: Notice[];
};

export type StowageComment = {
  id: string;
  cargoId: string;
  author: string;
  role: '船长' | '码头' | '货主';
  content: string;
  status: '待确认' | '已接受' | '已退回';
};

// ---------------------------------------------------------------------------
// 初始数据
// ---------------------------------------------------------------------------

const nowLabel = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
const nowFull = () => new Date().toLocaleString('zh-CN', { hour12: false });
export const terminalName: Record<TerminalId, string> = { shore: '岸基配载员', ship: '船上大副' };
let idSeq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idSeq += 1)}`;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const seedCargo: Cargo[] = [
  { id: 'BL-88214', bill: 'SEA-88214', type: '集装箱', bay: 12, row: 4, tier: 2, deck: '主甲板', weight: 24.6, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '已绑扎', color: '#2b7c75', dgDistance: 0, requiredLashPoints: 4, appliedLashPoints: 4, hatchId: 'HC-01', footprintArea: 28.4, hatchLoadRecorded: true },
  { id: 'BL-88219', bill: 'SEA-88219', type: '集装箱', bay: 13, row: 4, tier: 2, deck: '主甲板', weight: 28.1, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: 'UN 1263', lashing: '需复核', color: '#c77835', dgDistance: 5.4, requiredLashPoints: 6, appliedLashPoints: 6, hatchId: 'HC-01', footprintArea: 28.4, hatchLoadRecorded: true },
  { id: 'BL-88231', bill: 'SEA-88231', type: '集装箱', bay: 10, row: 6, tier: 1, deck: '主甲板', weight: 18.2, dimension: '20 × 8 × 8.6 ft', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#366d94', dgDistance: 0, requiredLashPoints: 4, appliedLashPoints: 4, hatchId: 'HC-01', footprintArea: 14.9, hatchLoadRecorded: true },
  { id: 'BL-88240', bill: 'SEA-88240', type: '集装箱', bay: 8, row: 2, tier: 2, deck: '货舱', weight: 31.4, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '待绑扎', color: '#6d528d', dgDistance: 0, requiredLashPoints: 4, appliedLashPoints: 2, hatchId: 'HC-02', footprintArea: 28.4, hatchLoadRecorded: true },
  { id: 'BL-88247', bill: 'SEA-88247', type: '重大件', bay: 15, row: 0, tier: 1, deck: '主甲板', weight: 112.5, dimension: '18.4 × 4.2 × 4.8 m', port: '温哥华', hazmat: '无', lashing: '需复核', color: '#b64f49', dgDistance: 0, requiredLashPoints: 8, appliedLashPoints: 6, hatchId: 'HC-03', footprintArea: 77.3, hatchLoadRecorded: true },
  // 旧草稿导入：缺少舱盖板/舱底承重记录，补齐前禁止重排
  { id: 'BL-88254', bill: 'SEA-88254', type: '散货', bay: 5, row: 0, tier: 0, deck: '货舱', weight: 286.0, dimension: '散装 / 420 m³', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#9a7836', dgDistance: 0, requiredLashPoints: 0, appliedLashPoints: 0, hatchId: 'HC-02', footprintArea: 84.0, hatchLoadRecorded: false, legacyDraft: true }
];

const seedHatches: HatchCover[] = [
  { id: 'HC-01', label: '1# 舱盖板（主甲板 B10–13）', bayFrom: 10, bayTo: 13, maxPressure: 3.0, maxTotal: 120 },
  { id: 'HC-02', label: '2# 货舱舱底（B4–8）', bayFrom: 4, bayTo: 8, maxPressure: 4.0, maxTotal: 420 },
  { id: 'HC-03', label: '3# 重大件舱盖板（B14–16）', bayFrom: 14, bayTo: 16, maxPressure: 2.2, maxTotal: 130 }
];

const seedComments: StowageComment[] = [
  { id: 'CM-21', cargoId: 'BL-88219', author: '港方配载', role: '码头', content: '危险品箱与船员生活区保持隔离，请在最终图中标注危险品隔离线。', status: '待确认' },
  { id: 'CM-22', cargoId: 'BL-88247', author: '周船长', role: '船长', content: '重大件横向支撑需增加两组绑扎点，检查甲板局部强度。', status: '待确认' },
  { id: 'CM-23', cargoId: 'BL-88254', author: '货主代表', role: '货主', content: '釜山港卸货前不得覆盖散货舱口，已接受当前安排。', status: '已接受' }
];

function makeTerminal(id: TerminalId, label: string, role: string): TerminalState {
  return { id, label, role, online: true, revision: 5, status: 'draft', anchorBill: null, ack: null, lastError: null };
}

const freshState = (): ReleaseState => ({
  drafts: { shore: clone(seedCargo), ship: clone(seedCargo) },
  hatchCovers: clone(seedHatches),
  terminals: { shore: makeTerminal('shore', '岸基配载终端', '岸基配载员'), ship: makeTerminal('ship', '船端大副终端', '船上大副') },
  activeTerminal: 'shore',
  planRevision: 5,
  verdictComputedAt: nowFull(),
  comments: clone(seedComments),
  acceptedLimits: [],
  viewMode: '3d',
  activeCargoId: 'BL-88247',
  draftSavedAt: '09:52',
  snapshot: null,
  pending: [],
  batches: [],
  inbox: { shore: [], ship: [] },
  logs: [{ id: nextId('LOG'), time: nowLabel(), terminalId: 'system', text: '两终端基线一致（V5），等待靠泊前调整与开航放行确认。', kind: 'system' }],
  notices: []
});

const STORAGE_KEY = 'yy62-release-v2';
const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
const initialState: ReleaseState = raw ? { ...freshState(), ...(JSON.parse(raw) as ReleaseState) } : freshState();

// ---------------------------------------------------------------------------
// 纯函数：操作应用 / 稳性 / 校核
// ---------------------------------------------------------------------------

export function applyOpToList(list: Cargo[], op: StowOp) {
  const target = list.find((item) => item.id === (op as { id?: string }).id);
  if (!target) {
    if (op.type === 'hatchConfig') return;
    return;
  }
  switch (op.type) {
    case 'stow':
      target.bay = op.bay; target.row = op.row; target.tier = op.tier;
      if (op.deck) target.deck = op.deck;
      break;
    case 'lashing':
      target.lashing = op.lashing;
      target.appliedLashPoints = op.appliedLashPoints;
      break;
    case 'segregation':
      target.dgDistance = op.dgDistance;
      break;
    case 'hatchLoad':
      target.hatchId = op.hatchId;
      target.footprintArea = op.footprintArea;
      target.hatchLoadRecorded = true;
      target.legacyDraft = false;
      break;
  }
}

export function applyHatchConfig(hatches: HatchCover[], op: Extract<StowOp, { type: 'hatchConfig' }>) {
  const hatch = hatches.find((item) => item.id === op.hatchId);
  if (hatch) { hatch.maxPressure = op.maxPressure; hatch.maxTotal = op.maxTotal; }
}

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
    if (existing) issues.push({ id: `${item.id}-overlap`, cargoId: item.id, level: 'high', title: '货位重叠', detail: `${item.id} 与 ${existing.id} 占用相同货位。` });
    slots.set(key, item);
    if (item.type === '集装箱' && item.weight > 30 && item.tier >= 3) issues.push({ id: `${item.id}-stack`, cargoId: item.id, level: 'medium', title: '上层堆重超限', detail: `${item.id} 不应放在第 ${item.tier} 层。` });
  });
  return issues;
}

export type ReleaseCheck = { key: string; label: string; pass: boolean; detail: string };
export type Evaluation = {
  checks: ReleaseCheck[];
  pass: boolean;
  stability: ReturnType<typeof calculateStability>;
  computedAt: string;
};

const MIN_DG_DISTANCE = 6; // 危险品与生活区/边界最小隔离距离（方案要求）

export function evaluatePlan(
  cargo: Cargo[],
  hatchCovers: HatchCover[],
  openPendingCount: number,
  terminal: TerminalState,
  openBatchCount: number,
  computedAt: string
): Evaluation {
  const stability = calculateStability(cargo);
  const conflicts = detectConflicts(cargo);
  const checks: ReleaseCheck[] = [];

  checks.push({
    key: 'stability',
    label: '稳性与纵倾',
    pass: stability.stability >= 70,
    detail: stability.stability >= 70
      ? `稳性裕度 ${stability.stability.toFixed(1)}% ≥ 70%，纵倾：${stability.trim}`
      : `稳性裕度 ${stability.stability.toFixed(1)}% 低于控制线 70%，纵倾：${stability.trim}`
  });

  checks.push({
    key: 'stow',
    label: '货位与堆码',
    pass: conflicts.length === 0,
    detail: conflicts.length ? conflicts.map((item) => item.title).join('；') : '无货位重叠或堆重超限。'
  });

  const dgIssues = cargo.filter((item) => item.hazmat !== '无' && item.dgDistance < MIN_DG_DISTANCE);
  checks.push({
    key: 'segregation',
    label: '危险品隔离',
    pass: dgIssues.length === 0,
    detail: dgIssues.length
      ? dgIssues.map((item) => `${item.bill}（${item.hazmat}）隔离距离 ${item.dgDistance.toFixed(1)}m < ${MIN_DG_DISTANCE}m`).join('；')
      : '在船危险品与生活区、边界隔离距离均满足方案要求。'
  });

  const lashIssues = cargo.filter((item) => item.appliedLashPoints < item.requiredLashPoints || (item.weight > 100 && item.lashing !== '已绑扎'));
  checks.push({
    key: 'lashing',
    label: '绑扎点',
    pass: lashIssues.length === 0,
    detail: lashIssues.length
      ? lashIssues.map((item) => item.appliedLashPoints < item.requiredLashPoints
        ? `${item.bill} 绑扎点 ${item.appliedLashPoints}/${item.requiredLashPoints}`
        : `${item.bill} 重量 ${item.weight}t，状态“${item.lashing}”，须完成绑扎`).join('；')
      : '各票货物绑扎点数量与绑扎状态均满足要求。'
  });

  const missingLoad = cargo.filter((item) => !item.hatchLoadRecorded);
  const pressureIssues: string[] = [];
  const totalByHatch = new Map<string, number>();
  cargo.forEach((item) => {
    if (!item.hatchId) return;
    totalByHatch.set(item.hatchId, (totalByHatch.get(item.hatchId) ?? 0) + item.weight);
    const hatch = hatchCovers.find((h) => h.id === item.hatchId);
    if (hatch && item.weight / item.footprintArea > hatch.maxPressure) {
      pressureIssues.push(`${item.bill} 压强 ${(item.weight / item.footprintArea).toFixed(2)} t/m² 超 ${hatch.id} 限值 ${hatch.maxPressure} t/m²`);
    }
  });
  hatchCovers.forEach((hatch) => {
    const total = totalByHatch.get(hatch.id) ?? 0;
    if (total > hatch.maxTotal) pressureIssues.push(`${hatch.label} 合计 ${total.toFixed(1)}t 超承重 ${hatch.maxTotal}t`);
  });
  checks.push({
    key: 'hatch',
    label: '舱盖板承重',
    pass: missingLoad.length === 0 && pressureIssues.length === 0,
    detail: missingLoad.length
      ? `旧草稿缺承重记录：${missingLoad.map((item) => item.bill).join('、')}，补齐后才能重排与放行。`
      : pressureIssues.length
        ? pressureIssues.join('；')
        : hatchCovers.map((hatch) => `${hatch.id} ${(totalByHatch.get(hatch.id) ?? 0).toFixed(1)}/${hatch.maxTotal}t`).join('；')
  });

  checks.push({
    key: 'pending',
    label: '待处理项',
    pass: openPendingCount === 0,
    detail: openPendingCount ? `${openPendingCount} 项并发落选 / 断网合并 / 锁定后改动待处理。` : '无待处理改动。'
  });

  checks.push({
    key: 'channel',
    label: '链路与本地批次',
    pass: terminal.online && openBatchCount === 0,
    detail: !terminal.online
      ? '当前终端断网，改动保留为本地批次，回网合并后才能确认放行。'
      : openBatchCount
        ? `${openBatchCount} 个本地批次未完成提交/合并。`
        : '链路在线，无滞留本地批次。'
  });

  return { checks, pass: checks.every((check) => check.pass), stability, computedAt };
}

// ---------------------------------------------------------------------------
// Thunk：放行确认（单终端 / 双终端同时）、写入失败重试、回网合并
// ---------------------------------------------------------------------------

type ServerCallResult =
  | { terminalId: TerminalId; ok: true; ack: ReleaseAck; anchorBill: string }
  | { terminalId: TerminalId; ok: false; status: number; message: string; winner?: TerminalId; anchorBill: string };

export const submitRelease = createAsyncThunk('release/submit', async (terminalId: TerminalId, { getState }) => {
  const state = (getState() as { release: ReleaseState }).release;
  const terminal = state.terminals[terminalId];
  const anchorBill = pickAnchorBill(state, terminalId);
  const result = await submitReleaseToServer({ terminalId, revision: terminal.revision, anchorBill, latency: 460 });
  return packResult(terminalId, anchorBill, result);
});

/** 两终端同时提交：岸基 ACK 延迟 520ms、船端 760ms —— 先确认的一版保留 */
export const submitBothReleases = createAsyncThunk('release/submitBoth', async (_, { getState }) => {
  const state = (getState() as { release: ReleaseState }).release;
  const anchorBill = pickAnchorBill(state, state.activeTerminal);
  const calls = (['shore', 'ship'] as TerminalId[]).map((terminalId) =>
    submitReleaseToServer({
      terminalId,
      revision: state.terminals[terminalId].revision,
      anchorBill,
      latency: terminalId === 'shore' ? 520 : 760
    }).then((result) => packResult(terminalId, anchorBill, result))
  );
  return Promise.all(calls);
});

export const primeFailureAndSubmit = createAsyncThunk('release/primeFailure', async (terminalId: TerminalId, { dispatch }) => {
  primeNextWriteFailure();
  return dispatch(submitRelease(terminalId)).unwrap();
});

export const primeFailureAndSubmitBoth = createAsyncThunk('release/primeFailureBoth', async (_, { dispatch }) => {
  // 岸基先 ACK 成功锁定；船端（第二次到达的写入）失败，保留本地批次
  primeNextWriteFailure(2);
  return dispatch(submitBothReleases()).unwrap();
});

export const retryReleaseBatch = createAsyncThunk('release/retryBatch', async (batchId: string, { getState }) => {
  const state = (getState() as { release: ReleaseState }).release;
  const batch = state.batches.find((item) => item.id === batchId);
  if (!batch || batch.kind !== 'release') throw new Error('批次不存在');
  const result = await submitReleaseToServer({
    terminalId: batch.terminalId,
    revision: state.terminals[batch.terminalId].revision,
    anchorBill: batch.anchorBill,
    latency: 420
  });
  return { batchId, ...packResult(batch.terminalId, batch.anchorBill, result) };
});

export const goOnline = createAsyncThunk('release/goOnline', async (terminalId: TerminalId, { getState }) => {
  const state = (getState() as { release: ReleaseState }).release;
  const releaseBatch = state.batches.find((item) => item.terminalId === terminalId && item.kind === 'release' && item.status === '失败待重试');
  let release: ServerCallResult | null = null;
  if (releaseBatch) {
    const result = await submitReleaseToServer({
      terminalId,
      revision: state.terminals[terminalId].revision,
      anchorBill: releaseBatch.anchorBill,
      latency: 420
    });
    release = packResult(terminalId, releaseBatch.anchorBill, result);
  } else {
    await new Promise((resolve) => setTimeout(resolve, 480));
  }
  return { terminalId, release };
});

function pickAnchorBill(state: ReleaseState, terminalId: TerminalId): string {
  const active = state.drafts[terminalId].find((item) => item.id === state.activeCargoId);
  return active?.bill ?? state.drafts[terminalId][0]?.bill ?? 'SEA-00000';
}

function packResult(
  terminalId: TerminalId,
  anchorBill: string,
  result: { data: ReleaseAck } | { error: { status: number; winner?: TerminalId; message: string } }
): ServerCallResult {
  if ('data' in result) return { terminalId, ok: true, ack: result.data, anchorBill };
  return { terminalId, ok: false, status: result.error.status, winner: result.error.winner, message: result.error.message, anchorBill };
}

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

function pushLog(state: ReleaseState, terminalId: LogEntry['terminalId'], text: string, kind: LogEntry['kind']) {
  state.logs.unshift({ id: nextId('LOG'), time: nowLabel(), terminalId, text, kind });
}

function pushNotice(state: ReleaseState, tone: Notice['tone'], text: string) {
  state.notices.unshift({ id: nextId('NTF'), tone, text });
  if (state.notices.length > 4) state.notices.length = 4;
}

function openEditBatch(state: ReleaseState, terminalId: TerminalId, revision: number): LocalBatch {
  const existing = state.batches.find((item) => item.terminalId === terminalId && item.kind === 'edit' && item.status === '本地保留');
  if (existing) return existing;
  const batch: LocalBatch = {
    id: nextId('BAT'),
    kind: 'edit',
    terminalId,
    anchorBill: '—',
    baseRevision: revision,
    ops: [],
    createdAt: nowFull(),
    status: '本地保留'
  };
  state.batches.unshift(batch);
  return batch;
}

function cargoBefore(cargo: Cargo, op: StowOp): Partial<Cargo> {
  const snapshot: Partial<Cargo> = {};
  if (op.type === 'stow') Object.assign(snapshot, { bay: cargo.bay, row: cargo.row, tier: cargo.tier, deck: cargo.deck });
  if (op.type === 'lashing') Object.assign(snapshot, { lashing: cargo.lashing, appliedLashPoints: cargo.appliedLashPoints });
  if (op.type === 'segregation') snapshot.dgDistance = cargo.dgDistance;
  if (op.type === 'hatchLoad') Object.assign(snapshot, { hatchId: cargo.hatchId, footprintArea: cargo.footprintArea, hatchLoadRecorded: cargo.hatchLoadRecorded });
  return snapshot;
}

function cargoAfter(op: StowOp): Partial<Cargo> | Partial<HatchCover> {
  if (op.type === 'stow') return { bay: op.bay, row: op.row, tier: op.tier, ...(op.deck ? { deck: op.deck } : {}) };
  if (op.type === 'lashing') return { lashing: op.lashing, appliedLashPoints: op.appliedLashPoints };
  if (op.type === 'segregation') return { dgDistance: op.dgDistance };
  if (op.type === 'hatchConfig') return { maxPressure: op.maxPressure, maxTotal: op.maxTotal };
  return { hatchId: op.hatchId, footprintArea: op.footprintArea, hatchLoadRecorded: true };
}

const slice = createSlice({
  name: 'release',
  initialState,
  reducers: {
    setActiveTerminal(state, action: PayloadAction<TerminalId>) { state.activeTerminal = action.payload; },
    selectCargo(state, action: PayloadAction<string>) { state.activeCargoId = action.payload; },
    setViewMode(state, action: PayloadAction<'3d' | 'section'>) { state.viewMode = action.payload; },
    dismissNotice(state, action: PayloadAction<string>) {
      state.notices = state.notices.filter((item) => item.id !== action.payload);
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

    /** 断网开关：下线立即开本地批次；上线走 goOnline thunk 合并 */
    toggleOffline(state, action: PayloadAction<TerminalId>) {
      const terminal = state.terminals[action.payload];
      terminal.online = !terminal.online;
      if (!terminal.online) {
        openEditBatch(state, terminal.id, terminal.revision);
        pushLog(state, terminal.id, `${terminal.label}断网：货位改动开始保留为本地批次，回网后合并。`, 'sync');
        pushNotice(state, 'info', `${terminal.label}已断网，改动将保留在本地批次。`);
      }
    },

    /** 货物 / 隔离 / 绑扎 / 承重的统一编辑入口 */
    recordEdit(state, action: PayloadAction<{ op: StowOp; terminalId?: TerminalId }>) {
      const op = action.payload.op;
      const terminalId = action.payload.terminalId ?? state.activeTerminal;
      const terminal = state.terminals[terminalId];
      const draft = state.drafts[terminalId];
      const target = op.type === 'hatchConfig' ? null : draft.find((item) => item.id === op.id);

      if (op.type === 'hatchConfig') {
        const hatch = state.hatchCovers.find((item) => item.id === op.hatchId);
        if (!hatch) return;
        const before = { maxPressure: hatch.maxPressure, maxTotal: hatch.maxTotal };
        applyHatchConfig(state.hatchCovers, op);
        finalizeEdit(state, terminalId, op, before, { maxPressure: op.maxPressure, maxTotal: op.maxTotal }, op.hatchId, hatch.label);
        state.verdictComputedAt = nowFull();
        return;
      }

      if (!target) return;
      // 旧草稿缺承重记录：补齐前禁止重排（货位移动）
      if (op.type === 'stow' && !target.hatchLoadRecorded) {
        const text = `${target.bill} 为旧草稿导入货物，缺少舱盖板/舱底承重记录，补齐后才能重排。`;
        pushNotice(state, 'error', text);
        pushLog(state, terminalId, `重排被拦截：${text}`, 'stow');
        return;
      }
      const before = cargoBefore(target, op);
      applyOpToList(draft, op);
      finalizeEdit(state, terminalId, op, before, cargoAfter(op), target.id, target.bill);
      state.verdictComputedAt = nowFull();
    },

    /** 为旧草稿补齐舱盖板/舱底承重记录 */
    fillHatchLoad(state, action: PayloadAction<{ id: string; hatchId: string; footprintArea: number }>) {
      const terminalId = state.activeTerminal;
      const target = state.drafts[terminalId].find((item) => item.id === action.payload.id);
      if (!target) return;
      const op: StowOp = { type: 'hatchLoad', ...action.payload };
      const before = cargoBefore(target, op);
      applyOpToList(state.drafts[terminalId], op);
      finalizeEdit(state, terminalId, op, before, cargoAfter(op), target.id, target.bill);
      pushNotice(state, 'success', `${target.bill} 承重记录已补齐，可重新安排货位。`);
      state.verdictComputedAt = nowFull();
    },

    resolvePending(state, action: PayloadAction<{ id: string; decision: '已接受' | '已退回' }>) {
      const item = state.pending.find((entry) => entry.id === action.payload.id);
      if (!item || item.status !== '待处理') return;
      item.status = action.payload.decision;
      const applyPartial = (cargo: Cargo) => {
        const partial = action.payload.decision === '已接受' ? item.after : item.before;
        if (!partial) return;
        if (item.opKind === 'hatchConfig') return;
        Object.assign(cargo, partial);
      };
      if (item.reason === '锁定后改动') {
        // 锁定后改动此前已同步到在线草稿：接受即保留，退回则回滚所有草稿
        if (action.payload.decision === '已退回') state.drafts[item.sourceTerminal].forEach((cargo) => cargo.id === item.cargoId && applyPartial(cargo));
        const peer = state.drafts[item.sourceTerminal === 'shore' ? 'ship' : 'shore'];
        if (action.payload.decision === '已退回') peer.forEach((cargo) => cargo.id === item.cargoId && applyPartial(cargo));
      } else if (action.payload.decision === '已接受') {
        // 落选/断网改动被采纳：写入另一个终端的草稿
        const peerId: TerminalId = item.sourceTerminal === 'shore' ? 'ship' : 'shore';
        const peerCargo = state.drafts[peerId].find((cargo) => cargo.id === item.cargoId);
        if (peerCargo && item.after) Object.assign(peerCargo, item.after);
      } else {
        // 退回来源终端草稿中的改动
        if (item.opKind === 'release') return;
        const sourceCargo = state.drafts[item.sourceTerminal].find((cargo) => cargo.id === item.cargoId);
        if (sourceCargo && item.before) Object.assign(sourceCargo, item.before);
      }
      pushLog(state, item.sourceTerminal, `待处理项 ${item.bill}（${item.reason}）${action.payload.decision === '已接受' ? '已接受并合并' : '已退回'}。`, 'system');
    },

    resetDemo() {
      resetReleaseServer();
      const fresh = freshState();
      if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
      return fresh;
    }
  },

  extraReducers: (builder) => {
    builder
      .addCase(submitRelease.pending, (state, action) => {
        state.terminals[action.meta.arg].status = 'submitting';
        state.terminals[action.meta.arg].lastError = null;
      })
      .addCase(submitRelease.fulfilled, (state, action) => {
        applyServerResult(state, action.payload);
      })
      .addCase(submitBothReleases.pending, (state) => {
        state.terminals.shore.status = 'submitting';
        state.terminals.ship.status = 'submitting';
        state.terminals.shore.lastError = null;
        state.terminals.ship.lastError = null;
      })
      .addCase(submitBothReleases.fulfilled, (state, action) => {
        action.payload.forEach((result) => applyServerResult(state, result));
      })
      .addCase(retryReleaseBatch.fulfilled, (state, action) => {
        const batch = state.batches.find((item) => item.id === action.payload.batchId);
        if (batch && action.payload.ok) batch.status = '已提交';
        applyServerResult(state, action.payload);
      })
      .addCase(goOnline.pending, (state, action) => {
        pushLog(state, action.meta.arg, `${state.terminals[action.meta.arg].label}链路恢复中，正在合并本地批次…`, 'sync');
      })
      .addCase(goOnline.fulfilled, (state, action) => {
        mergeOnReconnect(state, action.payload.terminalId);
        if (action.payload.release) applyServerResult(state, action.payload.release);
      });
  }
});

function finalizeEdit(
  state: ReleaseState,
  terminalId: TerminalId,
  op: StowOp,
  before: Partial<Cargo> | Partial<HatchCover>,
  after: Partial<Cargo> | Partial<HatchCover>,
  cargoId: string,
  bill: string
) {
  const terminal = state.terminals[terminalId];
  const kindLabel = opKindLabel[op.type];
  if (!terminal.online) {
    // 断网期间：改动只进本地草稿与本地批次
    const batch = openEditBatch(state, terminalId, terminal.revision);
    batch.ops.push(op);
    terminal.revision += 1;
    pushLog(state, terminalId, `断网本地改动：${bill} ${kindLabel}（批次 ${batch.id.slice(-4)}），回网后合并。`, op.type);
    return;
  }
  if (state.snapshot) {
    // 已锁定快照不可覆盖：改动进入待处理，但稳性与放行结论立即重算
    state.pending.unshift({
      id: nextId('PD'),
      reason: '锁定后改动',
      sourceTerminal: terminalId,
      opKind: op.type,
      cargoId,
      bill,
      title: `${kindLabel}改动发生在快照锁定之后`,
      detail: describeOp(op, bill),
      before,
      after,
      status: '待处理',
      createdAt: nowFull()
    });
    pushLog(state, terminalId, `快照 V${state.snapshot.revision} 已锁定：${bill} ${kindLabel}改动进入待处理，不覆盖锁定快照；稳性与放行结论已重算。`, op.type);
  } else {
    pushLog(state, terminalId, `${bill} ${kindLabel}已调整，稳性与放行结论立即重算。`, op.type);
  }
  // 在线协同：同步给同样在线的另一终端；对方离线则进其收件箱，回网补合并
  const peerId: TerminalId = terminalId === 'shore' ? 'ship' : 'shore';
  const peer = state.terminals[peerId];
  if (state.snapshot) {
    // 已锁定快照不可覆盖：版本号不再推进、已放行结论不撤销，改动只进待处理
    if (peer.online) applyOpToDraft(state.drafts[peerId], state.hatchCovers, op);
    else state.inbox[peerId].push(op);
    state.draftSavedAt = nowLabel();
    return;
  }
  if (peer.online) applyOpToDraft(state.drafts[peerId], state.hatchCovers, op);
  else state.inbox[peerId].push(op);
  state.planRevision += 1;
  terminal.revision = state.planRevision;
  if (peer.online) peer.revision = state.planRevision;
  // 未锁定时的任一安全相关改动后，未重新确认的放行结论一律回到草稿
  (['shore', 'ship'] as TerminalId[]).forEach((id) => {
    if (state.terminals[id].status === 'cleared') state.terminals[id].status = 'draft';
  });
  state.draftSavedAt = nowLabel();
}

function applyOpToDraft(draft: Cargo[], hatchCovers: HatchCover[], op: StowOp) {
  if (op.type === 'hatchConfig') applyHatchConfig(hatchCovers, op);
  else applyOpToList(draft, op);
}

function describeOp(op: StowOp, bill: string): string {
  switch (op.type) {
    case 'stow': return `${bill} 货位改为 Bay ${op.bay} / Row ${op.row} / Tier ${op.tier}`;
    case 'lashing': return `${bill} 绑扎状态“${op.lashing}”，绑扎点 ${op.appliedLashPoints}`;
    case 'segregation': return `${bill} 危险品隔离距离调整为 ${op.dgDistance.toFixed(1)} m`;
    case 'hatchLoad': return `${bill} 承重记录补齐：承载位 ${op.hatchId}，承压面积 ${op.footprintArea} m²`;
    case 'hatchConfig': return `${op.hatchId} 承重限值改为 ${op.maxPressure} t/m²、合计 ${op.maxTotal} t`;
  }
}

function diffDraftAgainstSnapshot(state: ReleaseState, terminalId: TerminalId, reason: PendingReason): PendingItem[] {
  if (!state.snapshot) return [];
  const items: PendingItem[] = [];
  state.drafts[terminalId].forEach((cargo) => {
    const base = state.snapshot!.cargo.find((item) => item.id === cargo.id);
    if (!base) return;
    const fields: [keyof Cargo, StowOp['type'], string][] = [
      ['bay', 'stow', '货位'], ['row', 'stow', '货位'], ['tier', 'stow', '货位'],
      ['lashing', 'lashing', '绑扎'], ['appliedLashPoints', 'lashing', '绑扎'],
      ['dgDistance', 'segregation', '危险品隔离'],
      ['hatchId', 'hatchLoad', '舱盖板承重'], ['footprintArea', 'hatchLoad', '舱盖板承重']
    ];
    const changedFields = fields.filter(([field]) => String(base[field]) !== String(cargo[field]));
    if (!changedFields.length) return;
    const kinds = Array.from(new Set(changedFields.map(([, kind]) => kind)));
    const before: Partial<Cargo> = {};
    const after: Partial<Cargo> = {};
    changedFields.forEach(([field]) => {
      (before as Record<string, unknown>)[field] = base[field];
      (after as Record<string, unknown>)[field] = cargo[field];
    });
    items.push({
      id: nextId('PD'),
      reason,
      sourceTerminal: terminalId,
      opKind: kinds.length === 1 ? kinds[0] : 'stow',
      cargoId: cargo.id,
      bill: cargo.bill,
      title: `${cargo.bill} 与锁定快照存在 ${kinds.map((kind) => opKindLabel[kind]).join('/')}差异`,
      detail: changedFields.map(([field, , label]) => `${label}.${field}：${String(base[field])} → ${String(cargo[field])}`).join('；'),
      before,
      after,
      status: '待处理',
      createdAt: nowFull()
    });
  });
  return items;
}

function applyServerResult(state: ReleaseState, result: ServerCallResult) {
  const terminal = state.terminals[result.terminalId];
  if (result.ok) {
    const winnerDraft = state.drafts[result.terminalId];
    if (!state.snapshot) {
      // 先确认的一版：固化只读快照
      state.snapshot = {
        revision: result.ack.revision,
        winner: result.terminalId,
        ackId: result.ack.ackId,
        docNo: result.ack.docNo,
        lockedAt: result.ack.lockedAt,
        anchorBill: result.anchorBill,
        cargo: clone(winnerDraft),
        hatchCovers: clone(state.hatchCovers)
      };
    }
    terminal.status = 'cleared';
    terminal.anchorBill = result.anchorBill;
    terminal.ack = result.ack;
    terminal.lastError = null;
    // 已提交成功的放行批次出列
    state.batches.filter((batch) => batch.kind === 'release' && batch.terminalId === result.terminalId).forEach((batch) => { batch.status = '已提交'; batch.error = undefined; });
    pushLog(state, result.terminalId, `放行确认成功（原提单号 ${result.anchorBill}）：回执 ${result.ack.ackId}，放行书 ${result.ack.docNo}，快照 V${result.ack.revision} 已锁定。`, 'release');
    pushNotice(state, 'success', `${terminal.label} 放行确认成功：${result.ack.docNo}`);
    return;
  }

  terminal.anchorBill = result.anchorBill;
  if (result.status === 409) {
    // 后确认的一版：不覆盖锁定快照，整版差异进入待处理
    terminal.status = 'pending';
    terminal.lastError = result.message;
    const items = diffDraftAgainstSnapshot(state, result.terminalId, '并发落选');
    if (items.length === 0) {
      // 内容与锁定版本一致：落选的放行尝试本身仍需留痕待处理
      items.push({
        id: nextId('PD'),
        reason: '并发落选',
        sourceTerminal: result.terminalId,
        opKind: 'release',
        cargoId: result.anchorBill,
        bill: result.anchorBill,
        title: '并发确认落选（内容与锁定版本一致）',
        detail: `${terminalName[result.terminalId]}与${result.winner ? terminalName[result.winner] : '先确认终端'}同时提交；先确认的一版 V${state.snapshot?.revision ?? '?'} 已保留，本版放行请求待人工确认关闭，未覆盖锁定快照。`,
        status: '待处理',
        createdAt: nowFull()
      });
    }
    state.pending.unshift(...items);
    pushLog(state, result.terminalId, `并发确认落选：${result.message} ${items.length} 项差异进入待处理。`, 'release');
    pushNotice(state, 'error', `${terminal.label} 并发确认落选，${items.length} 项差异待处理。`);
  } else {
    // 写入失败：保留本地批次，从原提单号重试
    terminal.status = 'failed';
    terminal.lastError = result.message;
    const existing = state.batches.find((batch) => batch.kind === 'release' && batch.terminalId === result.terminalId && batch.status === '失败待重试');
    if (existing) { existing.error = result.message; }
    else {
      state.batches.unshift({
        id: nextId('BAT'),
        kind: 'release',
        terminalId: result.terminalId,
        anchorBill: result.anchorBill,
        baseRevision: terminal.revision,
        ops: [],
        createdAt: nowFull(),
        status: '失败待重试',
        error: result.message
      });
    }
    pushLog(state, result.terminalId, `放行写入失败：本地批次已保留，将从原提单号 ${result.anchorBill} 重试。`, 'release');
    pushNotice(state, 'error', result.message);
  }
}

function mergeOnReconnect(state: ReleaseState, terminalId: TerminalId) {
  const terminal = state.terminals[terminalId];
  terminal.online = true;

  // 1) 对方在线期间、本机离线时暂存的收件箱改动
  const inboxOps = state.inbox[terminalId];
  if (inboxOps.length) {
    inboxOps.forEach((op) => applyOpToDraft(state.drafts[terminalId], state.hatchCovers, op));
    pushLog(state, terminalId, `回网合并：接收对端在线期间改动 ${inboxOps.length} 项，已并入本机草稿。`, 'sync');
    state.inbox[terminalId] = [];
  }

  // 2) 本机断网期间保留的编辑批次
  const editBatch = state.batches.find((batch) => batch.terminalId === terminalId && batch.kind === 'edit' && batch.status === '本地保留');
  if (editBatch && editBatch.ops.length) {
    const locked = !!state.snapshot;
    if (locked) {
      // 锁定后回网：逐项进入待处理，不覆盖快照
      editBatch.ops.forEach((op) => {
        const cargo = op.type === 'hatchConfig'
          ? null
          : state.drafts[terminalId].find((item) => item.id === op.id);
        state.pending.unshift({
          id: nextId('PD'),
          reason: '断网合并',
          sourceTerminal: terminalId,
          opKind: op.type,
          cargoId: cargo?.id ?? (op.type === 'hatchConfig' ? op.hatchId : ''),
          bill: cargo?.bill ?? (op.type === 'hatchConfig' ? op.hatchId : ''),
          title: `断网期间${opKindLabel[op.type]}改动待合并`,
          detail: describeOp(op, cargo?.bill ?? op.type),
          after: cargo ? cargoAfter(op) : undefined,
          status: '待处理',
          createdAt: nowFull()
        });
      });
      editBatch.status = '已合并';
      pushLog(state, terminalId, `回网：快照已锁定，断网批次 ${editBatch.ops.length} 项改动进入待处理，未覆盖锁定快照。`, 'sync');
    } else {
      const peerId: TerminalId = terminalId === 'shore' ? 'ship' : 'shore';
      editBatch.ops.forEach((op) => {
        if (state.terminals[peerId].online) applyOpToDraft(state.drafts[peerId], state.hatchCovers, op);
        else state.inbox[peerId].push(op);
      });
      state.planRevision += editBatch.ops.length;
      terminal.revision = state.planRevision;
      if (state.terminals[peerId].online) state.terminals[peerId].revision = state.planRevision;
      editBatch.status = '已合并';
      pushLog(state, terminalId, `回网合并：断网批次 ${editBatch.ops.length} 项改动已并入共享草稿（V${state.planRevision}）。`, 'sync');
    }
  }
  state.verdictComputedAt = nowFull();
  pushNotice(state, 'success', `${terminal.label}已回网，本地批次合并完成。`);
}

export const {
  setActiveTerminal,
  selectCargo,
  setViewMode,
  addComment,
  acceptComment,
  rejectComment,
  acceptLimit,
  toggleOffline,
  recordEdit,
  fillHatchLoad,
  resolvePending,
  dismissNotice,
  resetDemo
} = slice.actions;

// ---------------------------------------------------------------------------
// Store / 选择器
// ---------------------------------------------------------------------------

export const store = configureStore({
  reducer: { release: slice.reducer, [stowageApi.reducerPath]: stowageApi.reducer },
  middleware: (getDefault) => getDefault().concat(stowageApi.middleware)
});

store.subscribe(() => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(store.getState().release));
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const selectActiveTerminal = (state: RootState) => state.release.terminals[state.release.activeTerminal];
export const selectActiveCargo = (state: RootState) =>
  state.release.drafts[state.release.activeTerminal].find((item) => item.id === state.release.activeCargoId) ??
  state.release.drafts[state.release.activeTerminal][0];

export function selectEvaluation(state: RootState): Evaluation {
  const release = state.release;
  const terminalId = release.activeTerminal;
  const terminal = release.terminals[terminalId];
  const openPending = release.pending.filter((item) => item.status === '待处理').length;
  const openBatches = release.batches.filter((batch) => batch.terminalId === terminalId && (batch.status === '本地保留' || batch.status === '失败待重试')).length;
  return evaluatePlan(release.drafts[terminalId], release.hatchCovers, openPending, terminal, openBatches, release.verdictComputedAt);
}

export { peekServerLock };
export type { Cargo, CargoType, HatchCover, LashingStatus };
