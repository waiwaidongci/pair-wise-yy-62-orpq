import { useMemo, useState, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  NumberInput,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconBan,
  IconCheck,
  IconChecklist,
  IconCircleCheck,
  IconClipboardCheck,
  IconCloudOff,
  IconDeviceFloppy,
  IconLock,
  IconLockOpen,
  IconPlayerPlay,
  IconRefresh,
  IconRepeat,
  IconRouter,
  IconShip,
  IconWifi,
  IconX
} from '@tabler/icons-react';
import { useGetVoyageQuery } from './api';
import {
  dismissNotice,
  fillHatchLoad,
  goOnline,
  primeFailureAndSubmit,
  primeFailureAndSubmitBoth,
  recordEdit,
  resetDemo,
  resolvePending,
  retryReleaseBatch,
  selectActiveCargo,
  selectActiveTerminal,
  selectEvaluation,
  setActiveTerminal,
  submitBothReleases,
  submitRelease,
  toggleOffline,
  opKindLabel,
  type RootState,
  type TerminalId,
  type DraftStatus,
  type LocalBatch,
  type PendingItem,
  type StowOp,
  type AppDispatch
} from './release';

const terminalName: Record<TerminalId, string> = { shore: '岸基配载员', ship: '船上大副' };
const terminalShort: Record<TerminalId, string> = { shore: '岸基', ship: '船端' };

function statusColor(status: DraftStatus) {
  switch (status) {
    case 'cleared': return 'teal';
    case 'pending': return 'orange';
    case 'failed': return 'red';
    case 'submitting': return 'blue';
    default: return 'gray';
  }
}

function statusLabel(status: DraftStatus) {
  switch (status) {
    case 'cleared': return '已放行（锁定）';
    case 'pending': return '待处理';
    case 'failed': return '写入失败';
    case 'submitting': return '确认中…';
    default: return '草稿（未核）';
  }
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><small>{eyebrow}</small><h1>{title}</h1><p>{description}</p></div><Group gap="xs">{actions}</Group></div>;
}

function DemoConsole() {
  const release = useSelector((root: RootState) => root.release);
  const dispatch = useDispatch<AppDispatch>();
  const active = release.activeTerminal;
  const anyOffline = !release.terminals.shore.online || !release.terminals.ship.online;
  return (
    <Card padding="md" className="console-card" withBorder>
      <Group justify="space-between" mb="xs">
        <Group gap={8}><IconRouter size={17} /><strong>双终端链路演示台</strong></Group>
        <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconRefresh size={13} />} onClick={() => dispatch(resetDemo())}>重置演示</Button>
      </Group>
      <Text size="xs" c="dimmed" mb="sm">切换视角、模拟断网/回网，并触发两终端“同时提交放行确认”的竞态（岸基 ACK 520ms 先到，船端 760ms 后到）。</Text>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
        {(['shore', 'ship'] as TerminalId[]).map((id) => {
          const terminal = release.terminals[id];
          return <Card key={id} padding="sm" withBorder className={active === id ? 'console-terminal active' : 'console-terminal'}>
            <Group justify="space-between">
              <Group gap={7}>
                <ThemeIcon size="sm" color={id === 'shore' ? 'grape' : 'blue'} variant="light">{id === 'shore' ? <IconDeviceFloppy size={13} /> : <IconShip size={13} />}</ThemeIcon>
                <Text size="sm" fw={700}>{terminal.label}</Text>
              </Group>
              <Badge size="sm" color={terminal.online ? 'teal' : 'red'} variant="light" leftSection={terminal.online ? <IconWifi size={11} /> : <IconCloudOff size={11} />}>{terminal.online ? '在线' : '断网'}</Badge>
            </Group>
            <Group gap="xs" mt="sm">
              <Button size="compact-xs" variant={active === id ? 'filled' : 'default'} color="teal" onClick={() => dispatch(setActiveTerminal(id))}>以此终端视角查看</Button>
              <Button size="compact-xs" variant="default" color={terminal.online ? 'orange' : 'teal'} leftSection={terminal.online ? <IconCloudOff size={12} /> : <IconWifi size={12} />} onClick={() => (terminal.online ? dispatch(toggleOffline(id)) : dispatch(goOnline(id)))}>{terminal.online ? '模拟断网' : '回网合并'}</Button>
            </Group>
            <Group gap="xs" mt={6}>
              <Badge size="sm" color={statusColor(terminal.status)}>{statusLabel(terminal.status)}</Badge>
              <Text size="xs" c="dimmed">V{terminal.revision}{terminal.anchorBill ? ` · 锚点 ${terminal.anchorBill}` : ''}</Text>
            </Group>
            {terminal.lastError && <Alert color="red" variant="light" mt="xs" p="xs" icon={<IconAlertTriangle size={15} />} title={<Text size="xs" fw={700}>{terminal.status === 'failed' ? '写入失败 · 本地批次已保留' : '并发落选 · 进入待处理'}</Text>}><Text size="xs">{terminal.lastError}</Text></Alert>}
          </Card>;
        })}
      </SimpleGrid>
      <Divider my="sm" />
      <Group gap="xs" grow>
        <Button size="xs" color="teal" variant="light" leftSection={<IconPlayerPlay size={14} />} disabled={anyOffline} onClick={() => dispatch(submitBothReleases())}>两终端同时提交（先确认者保留）</Button>
        <Button size="xs" variant="light" color="orange" leftSection={<IconBan size={14} />} disabled={anyOffline} onClick={() => dispatch(primeFailureAndSubmitBoth())}>同时提交 + 注入写入失败</Button>
        <Button size="xs" variant="light" color="red" leftSection={<IconX size={14} />} disabled={!release.terminals[active].online} onClick={() => dispatch(primeFailureAndSubmit(active))}>{terminalShort[active]}写入失败演示</Button>
      </Group>
      <Group gap="xs" mt="xs">
        <Button size="compact-xs" color="teal" disabled={!release.terminals[active].online || release.terminals[active].status === 'submitting'} onClick={() => dispatch(submitRelease(active))}>{terminalShort[active]}单独确认放行</Button>
      </Group>
    </Card>
  );
}

function Notices() {
  const notices = useSelector((root: RootState) => root.release.notices);
  const dispatch = useDispatch<AppDispatch>();
  if (!notices.length) return null;
  return <Stack gap={6} mb="md">
    {notices.map((notice) => <Alert key={notice.id} color={notice.tone === 'error' ? 'red' : notice.tone === 'success' ? 'teal' : 'blue'} variant="light" p="xs" icon={notice.tone === 'success' ? <IconCircleCheck size={15} /> : <IconAlertTriangle size={15} />} onClose={() => dispatch(dismissNotice(notice.id))} withCloseButton><Text size="xs">{notice.text}</Text></Alert>)}
  </Stack>;
}

const confirmChecks = [
  '重大件绑扎后由甲板部复核',
  '危险品隔离线在配载图中明确标注',
  '釜山卸货顺序不得改变'
];

function ClearanceGate() {
  const release = useSelector((root: RootState) => root.release);
  const evaluation = useSelector(selectEvaluation);
  const terminal = useSelector(selectActiveTerminal);
  const cargo = useSelector((root: RootState) => root.release.drafts[root.release.activeTerminal]);
  const dispatch = useDispatch<AppDispatch>();
  const [manualChecks, setManualChecks] = useState<string[]>([]);
  const openBatches = release.batches.filter((batch) => batch.terminalId === release.activeTerminal && (batch.status === '本地保留' || batch.status === '失败待重试'));
  const anchorBill = cargo.find((item) => item.id === release.activeCargoId)?.bill ?? cargo[0]?.bill ?? 'SEA-00000';
  const ready = evaluation.pass && manualChecks.length === confirmChecks.length;

  return <Card padding="md" withBorder>
    <Group justify="space-between" mb="sm">
      <Group gap={8}><IconClipboardCheck size={18} color={evaluation.pass ? '#1f7063' : '#aa671e'} /><strong>开航放行结论（{terminalName[release.activeTerminal]}视角）</strong></Group>
      <Badge color={terminal.status === 'cleared' ? 'teal' : evaluation.pass ? 'teal' : 'orange'} variant="light" leftSection={terminal.status === 'cleared' ? <IconLock size={12} /> : <IconLockOpen size={12} />}>{statusLabel(terminal.status)}</Badge>
    </Group>
    <Text size="xs" c="dimmed" mb="sm">任一隔离、绑扎或舱盖板承重改动后，下面的稳性与放行结论立即重算；最后重算：{evaluation.computedAt}</Text>
    <Table verticalSpacing={6} className="gate-table">
      <Table.Tbody>
        {evaluation.checks.map((check) => <Table.Tr key={check.key}>
          <Table.Td style={{ width: 36 }}>{check.pass ? <ThemeIcon size="sm" color="teal" variant="light"><IconCheck size={12} /></ThemeIcon> : <ThemeIcon size="sm" color="orange" variant="light"><IconAlertTriangle size={12} /></ThemeIcon>}</Table.Td>
          <Table.Td style={{ width: 120 }}><Text size="xs" fw={700}>{check.label}</Text></Table.Td>
          <Table.Td><Text size="xs" c={check.pass ? 'teal' : 'red'}>{check.detail}</Text></Table.Td>
        </Table.Tr>)}
      </Table.Tbody>
    </Table>
    <Divider my="sm" />
    <Text size="xs" fw={700} mb={6}>人工复核勾选项（锁定前确认）</Text>
    <Stack gap={4}>{confirmChecks.map((label) => <Checkbox key={label} size="xs" label={label} checked={manualChecks.includes(label)} onChange={() => setManualChecks((prev) => prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label])} />)}</Stack>
    <Group mt="md" justify="space-between">
      <Text size="xs" c="dimmed">放行写入将以原提单号 <b>{anchorBill}</b> 为锚点，失败后本地批次按该单号重试。</Text>
      <Button color="teal" leftSection={<IconPlayerPlay size={15} />} disabled={!ready || terminal.status === 'submitting'} onClick={() => dispatch(submitRelease(release.activeTerminal))}>
        {terminal.status === 'submitting' ? '确认中…' : ready ? `确认放行 V${terminal.revision}` : '未核结果停在草稿'}
      </Button>
    </Group>
    {!ready && <Text size="xs" c="orange" mt={6}>校核或人工复核未全部通过，当前结果仅为草稿，不能生成放行书。</Text>}
    {openBatches.length > 0 && <Text size="xs" c="red" mt={4}>本终端有 {openBatches.length} 个本地批次未完成（断网编辑 / 写入失败）。</Text>}
  </Card>;
}

function SnapshotCard() {
  const snapshot = useSelector((root: RootState) => root.release.snapshot);
  if (!snapshot) return <Card padding="md" withBorder className="snapshot-card empty">
    <Group gap={8} mb={6}><IconLockOpen size={17} /><strong>放行快照</strong></Group>
    <Text size="xs" c="dimmed">尚无终端完成放行确认。先确认的一版将在此固化为只读快照，后续任何改动都不会覆盖它。</Text>
  </Card>;
  return <Card padding="md" withBorder className="snapshot-card">
    <Group justify="space-between" mb={6}>
      <Group gap={8}><IconLock size={17} color="#1f7063" /><strong>已锁定只读快照 V{snapshot.revision}</strong></Group>
      <Badge color="teal" variant="light">{terminalName[snapshot.winner]}确认</Badge>
    </Group>
    <SimpleGrid cols={2} spacing={4}>
      <Text size="xs" c="dimmed">放行书编号</Text><Text size="xs" fw={700}>{snapshot.docNo}</Text>
      <Text size="xs" c="dimmed">岸基回执</Text><Text size="xs">{snapshot.ackId}</Text>
      <Text size="xs" c="dimmed">原提单号锚点</Text><Text size="xs">{snapshot.anchorBill}</Text>
      <Text size="xs" c="dimmed">锁定时间</Text><Text size="xs">{snapshot.lockedAt}</Text>
    </SimpleGrid>
    <Text size="xs" c="dimmed" mt={8}>快照包含 {snapshot.cargo.length} 票货物与 {snapshot.hatchCovers.length} 块舱盖板的承重限值；落选或断网差异只进待处理项。</Text>
  </Card>;
}

function PendingPanel() {
  const pending = useSelector((root: RootState) => root.release.pending);
  const dispatch = useDispatch<AppDispatch>();
  const open = pending.filter((item) => item.status === '待处理');
  return <Card padding={0} withBorder>
    <div className="panel-title">
      <div><strong>待处理项</strong><Text size="xs" c="dimmed">{open.length} 项待处理 · 显示来源终端与产生原因</Text></div>
      <Badge color={open.length ? 'orange' : 'teal'} variant="light">{open.length ? `${open.length} 待处理` : '全部处理'}</Badge>
    </div>
    <Table verticalSpacing="xs" horizontalSpacing="sm">
      <Table.Thead><Table.Tr><Table.Th>来源 / 原因</Table.Th><Table.Th>内容</Table.Th><Table.Th>状态</Table.Th><Table.Th>处理</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {pending.length === 0 && <Table.Tr><Table.Td colSpan={4}><Text size="xs" c="dimmed" py="sm">暂无待处理项。两终端并发落选、断网回网合并以及锁定后的改动都会出现在这里。</Text></Table.Td></Table.Tr>}
        {pending.map((item: PendingItem) => <Table.Tr key={item.id} className={item.status !== '待处理' ? 'row-resolved' : ''}>
          <Table.Td>
            <Badge size="xs" color={item.sourceTerminal === 'shore' ? 'grape' : 'blue'} variant="light">{terminalName[item.sourceTerminal]}</Badge><br />
            <Badge size="xs" mt={4} variant="outline" color={item.reason === '并发落选' ? 'orange' : item.reason === '断网合并' ? 'blue' : 'gray'}>{item.reason}</Badge><br />
            <Text span size="xs" c="dimmed" mt={3}>{item.createdAt.slice(5)}</Text>
          </Table.Td>
          <Table.Td>
            <Text size="xs" fw={700}>{item.bill} · {opKindLabel[item.opKind as StowOp['type']] ?? '放行'}</Text>
            <Text size="xs" c="dimmed" display="block">{item.title}</Text>
            <Text size="xs" display="block" mt={2}>{item.detail}</Text>
          </Table.Td>
          <Table.Td><Badge size="xs" color={item.status === '待处理' ? 'orange' : item.status === '已接受' ? 'teal' : 'gray'}>{item.status}</Badge></Table.Td>
          <Table.Td>
            {item.status === '待处理'
              ? <Group gap={4}><Button size="compact-xs" color="teal" leftSection={<IconCheck size={12} />} onClick={() => dispatch(resolvePending({ id: item.id, decision: '已接受' }))}>接受</Button><Button size="compact-xs" variant="default" color="gray" leftSection={<IconX size={12} />} onClick={() => dispatch(resolvePending({ id: item.id, decision: '已退回' }))}>退回</Button></Group>
              : <Text size="xs" c="dimmed">{item.status === '已接受' ? '已合并入草稿' : '已回滚'}</Text>}
          </Table.Td>
        </Table.Tr>)}
      </Table.Tbody>
    </Table>
  </Card>;
}

function BatchPanel() {
  const batches = useSelector((root: RootState) => root.release.batches);
  const dispatch = useDispatch<AppDispatch>();
  return <Card padding={0} withBorder>
    <div className="panel-title">
      <div><strong>本地批次（断网保留 / 失败重试）</strong><Text size="xs" c="dimmed">放行写入失败后保留本地批次，按原提单号重试</Text></div>
      <IconRepeat size={17} />
    </div>
    <Table verticalSpacing="xs" horizontalSpacing="sm">
      <Table.Thead><Table.Tr><Table.Th>批次</Table.Th><Table.Th>终端</Table.Th><Table.Th>原提单号 / 基线</Table.Th><Table.Th>内容</Table.Th><Table.Th>状态</Table.Th><Table.Th>操作</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {batches.length === 0 && <Table.Tr><Table.Td colSpan={6}><Text size="xs" c="dimmed" py="sm">暂无本地批次。</Text></Table.Td></Table.Tr>}
        {batches.map((batch: LocalBatch) => <Table.Tr key={batch.id}>
          <Table.Td><Text size="xs" fw={700}>{batch.id.slice(-6).toUpperCase()}</Text><Text size="xs" c="dimmed" display="block">{batch.createdAt.slice(5)}</Text></Table.Td>
          <Table.Td><Badge size="xs" color={batch.terminalId === 'shore' ? 'grape' : 'blue'} variant="light">{terminalShort[batch.terminalId]}</Badge></Table.Td>
          <Table.Td><Text size="xs">{batch.kind === 'release' ? batch.anchorBill : '编辑批次'}</Text><Text size="xs" c="dimmed" display="block">基线 V{batch.baseRevision}{batch.kind === 'release' ? ' · 放行写入' : ''}</Text></Table.Td>
          <Table.Td><Text size="xs">{batch.kind === 'edit' ? `${batch.ops.length} 项货位/隔离/绑扎/承重改动` : '开航放行确认写入'}</Text>{batch.error && <Text size="xs" c="red" display="block">{batch.error}</Text>}</Table.Td>
          <Table.Td><Badge size="xs" color={batch.status === '已合并' || batch.status === '已提交' ? 'teal' : batch.status === '失败待重试' ? 'red' : 'orange'}>{batch.status}</Badge></Table.Td>
          <Table.Td>{batch.status === '失败待重试' && <Button size="compact-xs" color="teal" leftSection={<IconRepeat size={12} />} onClick={() => dispatch(retryReleaseBatch(batch.id))}>从原提单号 {batch.anchorBill.slice(-5)} 重试</Button>}</Table.Td>
        </Table.Tr>)}
      </Table.Tbody>
    </Table>
  </Card>;
}

function HatchBackfillCard() {
  const dispatch = useDispatch<AppDispatch>();
  const release = useSelector((root: RootState) => root.release);
  const active = useSelector(selectActiveCargo);
  const hatchCovers = release.hatchCovers;
  const [hatchId, setHatchId] = useState(active.hatchId ?? hatchCovers[0]?.id ?? '');
  const [area, setArea] = useState(active.footprintArea);
  if (!active.hatchLoadRecorded) {
    return <Card padding="md" withBorder className="backfill-card">
      <Group gap={8} mb={6}><ThemeIcon color="red" variant="light" size="sm"><IconAlertTriangle size={13} /></ThemeIcon><strong>{active.bill} 缺少舱盖板/舱底承重记录（旧草稿）</strong></Group>
      <Text size="xs" c="dimmed" mb="sm">补齐承载位置与承压面积后才能重排该货物，否则货位调整会被拦截。</Text>
      <SimpleGrid cols={3} spacing="xs">
        <TextInput size="xs" label="承载舱盖板/舱底" value={hatchId} onChange={(event) => setHatchId(event.currentTarget.value)} />
        <NumberInput size="xs" label="承压面积 m²" min={1} value={area} onChange={(value) => setArea(Number(value) || 0)} />
        <Button size="xs" mt={18} color="teal" leftSection={<IconCheck size={14} />} onClick={() => dispatch(fillHatchLoad({ id: active.id, hatchId, footprintArea: area }))}>补齐承重记录</Button>
      </SimpleGrid>
    </Card>;
  }
  return null;
}

function HatchLimitsCard() {
  const hatchCovers = useSelector((root: RootState) => root.release.hatchCovers);
  const release = useSelector((root: RootState) => root.release);
  const dispatch = useDispatch<AppDispatch>();
  const cargo = release.drafts[release.activeTerminal];
  return <Card padding="md" withBorder>
    <Group gap={8} mb={4}><IconChecklist size={17} /><strong>舱盖板 / 舱底承重限值</strong></Group>
    <Text size="xs" c="dimmed" mb="sm">调整限值即视为承重改动，稳性与放行结论立即重算并记录来源。</Text>
    <Stack gap="sm">
      {hatchCovers.map((hatch) => {
        const used = cargo.filter((item) => item.hatchId === hatch.id).reduce((sum, item) => sum + item.weight, 0);
        const over = used > hatch.maxTotal;
        return <div key={hatch.id} className="hatch-limit-row">
          <Text size="xs" fw={700}>{hatch.label}</Text>
          <Group gap="xs" align="flex-end">
            <NumberInput size="xs" label="压强限值 t/m²" min={0} step={0.1} value={hatch.maxPressure} onChange={(value) => value && dispatch(recordEdit({ op: { type: 'hatchConfig', hatchId: hatch.id, maxPressure: Number(value), maxTotal: hatch.maxTotal } }))} />
            <NumberInput size="xs" label="合计限值 t" min={0} value={hatch.maxTotal} onChange={(value) => value && dispatch(recordEdit({ op: { type: 'hatchConfig', hatchId: hatch.id, maxPressure: hatch.maxPressure, maxTotal: Number(value) } }))} />
            <Badge color={over ? 'red' : 'teal'} variant="light" mb={5}>{used.toFixed(1)}t / {hatch.maxTotal}t</Badge>
          </Group>
        </div>;
      })}
    </Stack>
  </Card>;
}

function LogPanel() {
  const logs = useSelector((root: RootState) => root.release.logs);
  const iconFor = (kind: string) => kind === 'release' ? <IconClipboardCheck size={12} /> : kind === 'sync' ? <IconRouter size={12} /> : <IconRefresh size={12} />;
  return <Card padding="md" withBorder>
    <Group gap={8} mb={6}><IconRefresh size={16} /><strong>合并与确认流水</strong></Group>
    <div className="log-list">{logs.slice(0, 10).map((log) => <div key={log.id} className="log-row">
      <ThemeIcon size="xs" variant="light" color={log.terminalId === 'system' ? 'gray' : log.terminalId === 'shore' ? 'grape' : 'blue'}>{iconFor(log.kind)}</ThemeIcon>
      <Text size="xs" c="dimmed" className="log-time">{log.time}</Text>
      <Text size="xs">{log.text}</Text>
    </div>)}</div>
  </Card>;
}

export default function ReleasePage() {
  const { data } = useGetVoyageQuery();
  const navigate = useNavigate();
  const pendingOpen = useSelector((root: RootState) => root.release.pending.filter((item) => item.status === '待处理').length);
  const batchesOpen = useSelector((root: RootState) => root.release.batches.filter((item) => item.status === '本地保留' || item.status === '失败待重试').length);
  const memo = useMemo(() => ({ id: data?.id ?? 'V-2609-17' }), [data?.id]);
  return <div className="page release-page">
    <PageHeading
      eyebrow={`${memo.id} / DEPARTURE CLEARANCE`}
      title="开航放行确认"
      description="货物、货位、危险品隔离、绑扎点与舱盖板承重接入放行：先确认的一版锁定，落选版进待处理；未核结果停在草稿。"
      actions={<Button variant="default" leftSection={<IconClipboardCheck size={15} />} onClick={() => navigate('/print')}>查看放行打印页</Button>}
    />
    <Notices />
    <DemoConsole />
    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" mt="md">
      <ClearanceGate />
      <Stack gap="md">
        <SnapshotCard />
        <HatchBackfillCard />
        <HatchLimitsCard />
      </Stack>
    </SimpleGrid>
    <Group mt="md" mb="xs" gap="xs">
      <Badge color={pendingOpen ? 'orange' : 'teal'} size="lg">待处理 {pendingOpen}</Badge>
      <Badge color={batchesOpen ? 'red' : 'gray'} size="lg">本地批次 {batchesOpen}</Badge>
    </Group>
    <Stack gap="md">
      <PendingPanel />
      <BatchPanel />
      <LogPanel />
    </Stack>
  </div>;
}
