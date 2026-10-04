import { createApi } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import type { TerminalId } from './release';

export type { TerminalId };

export type CargoType = '集装箱' | '散货' | '重大件';
export type LashingStatus = '已绑扎' | '待绑扎' | '需复核';

export type Cargo = {
  id: string;
  bill: string;
  type: CargoType;
  bay: number;
  row: number;
  tier: number;
  deck: '主甲板' | '货舱';
  weight: number;
  dimension: string;
  port: string;
  hazmat: string;
  lashing: LashingStatus;
  color: string;
  /** 危险品与生活区/船舶边界的隔离距离（m） */
  dgDistance: number;
  /** 方案要求的绑扎点数 */
  requiredLashPoints: number;
  /** 实际投入的绑扎点数 */
  appliedLashPoints: number;
  /** 承载该货物的舱盖板 / 舱底分区 */
  hatchId: string | null;
  /** 货物承压面积 m²，用于舱盖板单位承重校核 */
  footprintArea: number;
  /** 舱盖板 / 舱底承重记录是否已补齐 */
  hatchLoadRecorded: boolean;
  /** 来自旧版草稿（迁移而来，缺承重记录） */
  legacyDraft?: boolean;
};

export type HatchCover = {
  id: string;
  label: string;
  bayFrom: number;
  bayTo: number;
  /** 允许单位承重 t/m² */
  maxPressure: number;
  /** 允许总承重 t */
  maxTotal: number;
};

const voyageCargo: Cargo[] = [
  { id: 'BL-88214', bill: 'SEA-88214', type: '集装箱', bay: 12, row: 4, tier: 2, deck: '主甲板', weight: 24.6, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '已绑扎', color: '#2b7c75', dgDistance: 0, requiredLashPoints: 4, appliedLashPoints: 4, hatchId: 'HC-01', footprintArea: 28.4, hatchLoadRecorded: true },
  { id: 'BL-88219', bill: 'SEA-88219', type: '集装箱', bay: 13, row: 4, tier: 2, deck: '主甲板', weight: 28.1, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: 'UN 1263', lashing: '需复核', color: '#c77835', dgDistance: 5.4, requiredLashPoints: 6, appliedLashPoints: 6, hatchId: 'HC-01', footprintArea: 28.4, hatchLoadRecorded: true },
  { id: 'BL-88231', bill: 'SEA-88231', type: '集装箱', bay: 10, row: 6, tier: 1, deck: '主甲板', weight: 18.2, dimension: '20 × 8 × 8.6 ft', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#366d94', dgDistance: 0, requiredLashPoints: 4, appliedLashPoints: 4, hatchId: 'HC-01', footprintArea: 14.9, hatchLoadRecorded: true },
  { id: 'BL-88240', bill: 'SEA-88240', type: '集装箱', bay: 8, row: 2, tier: 2, deck: '货舱', weight: 31.4, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '待绑扎', color: '#6d528d', dgDistance: 0, requiredLashPoints: 4, appliedLashPoints: 2, hatchId: 'HC-02', footprintArea: 28.4, hatchLoadRecorded: true },
  { id: 'BL-88247', bill: 'SEA-88247', type: '重大件', bay: 15, row: 0, tier: 1, deck: '主甲板', weight: 112.5, dimension: '18.4 × 4.2 × 4.8 m', port: '温哥华', hazmat: '无', lashing: '需复核', color: '#b64f49', dgDistance: 0, requiredLashPoints: 8, appliedLashPoints: 6, hatchId: 'HC-03', footprintArea: 77.3, hatchLoadRecorded: true },
  { id: 'BL-88254', bill: 'SEA-88254', type: '散货', bay: 5, row: 0, tier: 0, deck: '货舱', weight: 286.0, dimension: '散装 / 420 m³', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#9a7836', dgDistance: 0, requiredLashPoints: 0, appliedLashPoints: 0, hatchId: 'HC-02', footprintArea: 84.0, hatchLoadRecorded: false, legacyDraft: true }
];

export const voyageData = {
  id: 'V-2609-17',
  vessel: '海岳轮',
  imo: 'IMO 9782214',
  route: '上海 → 釜山 → 温哥华',
  departure: '2026-10-02 14:00',
  revision: 5,
  cargo: voyageCargo
};

// ---------------------------------------------------------------------------
// 模拟“岸基放行回执服务”
// 规则：先确认（先 ACK）的一版锁定快照；后到的终端得到 409，进入待处理。
// 幂等：同一原提单号锚点 + 终端的重试返回同一份回执。
// ---------------------------------------------------------------------------

export type ReleaseAck = {
  ackId: string;
  docNo: string;
  lockedAt: string;
  revision: number;
  winner: TerminalId;
};

type ServerLock = {
  revision: number;
  winner: TerminalId;
  ack: ReleaseAck;
  key: string;
};

let serverLock: ServerLock | null = null;
const failCallQueue: number[] = [];
let callCounter = 0;
let seq = 0;

/** 让下一次放行写入失败（模拟岸基回执超时）；step=2 表示第二次调用时失败 */
export function primeNextWriteFailure(step = 1) {
  failCallQueue.push(callCounter + step);
}

export function resetReleaseServer() {
  serverLock = null;
  failCallQueue.length = 0;
  callCounter = 0;
  seq = 0;
}

export function peekServerLock() {
  return serverLock ? { revision: serverLock.revision, winner: serverLock.winner } : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function submitReleaseToServer(args: {
  terminalId: TerminalId;
  revision: number;
  anchorBill: string;
  latency: number;
}): Promise<{ data: ReleaseAck } | { error: { status: number; winner?: TerminalId; message: string } }> {
  await sleep(args.latency);
  callCounter += 1;
  const failIndex = failCallQueue.indexOf(callCounter);
  if (failIndex >= 0) {
    failCallQueue.splice(failIndex, 1);
    return { error: { status: 500, message: '放行写入失败：岸基回执超时，请保留本地批次并从原提单号重试。' } };
  }
  const key = `${args.anchorBill}#V${args.revision}`;
  if (serverLock) {
    // 同一终端、同一原提单号锚点的重试：幂等返回原回执
    if (serverLock.winner === args.terminalId && serverLock.key === key) return { data: serverLock.ack };
    return {
      error: {
        status: 409,
        winner: serverLock.winner,
        message: `先确认的一版来自${serverLock.winner === 'shore' ? '岸基配载员' : '船上大副'}（V${serverLock.revision}），本版不覆盖已锁定快照，转入待处理。`
      }
    };
  }
  seq += 1;
  const ack: ReleaseAck = {
    ackId: `ACK-${String(seq).padStart(3, '0')}`,
    docNo: `SVC-${args.terminalId.toUpperCase()}-${args.revision}-${String(seq).padStart(3, '0')}`,
    lockedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    revision: args.revision,
    winner: args.terminalId
  };
  serverLock = { revision: args.revision, winner: args.terminalId, ack, key };
  return { data: ack };
}

const mockBaseQuery: BaseQueryFn = async (arg) => {
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (arg === 'voyage' || (typeof arg === 'object' && arg && 'url' in arg && (arg as { url: string }).url === 'voyage')) return { data: voyageData };
  return { error: { status: 404, data: 'Not found' } };
};

export const stowageApi = createApi({
  reducerPath: 'stowageApi',
  baseQuery: mockBaseQuery,
  tagTypes: ['Voyage'],
  endpoints: (builder) => ({
    getVoyage: builder.query<typeof voyageData, void>({ query: () => 'voyage', providesTags: ['Voyage'] })
  })
});

export const { useGetVoyageQuery } = stowageApi;
