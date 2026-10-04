import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import {
  ActionIcon,
  AppShell,
  AppShellHeader,
  AppShellMain,
  AppShellNavbar,
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  ThemeIcon
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconAnchor,
  IconCheck,
  IconClipboardCheck,
  IconCloudOff,
  IconCube,
  IconHistory,
  IconLayoutBoardSplit,
  IconLock,
  IconPrinter,
  IconRefresh,
  IconRulerMeasure,
  IconRoute,
  IconShip,
  IconUsers,
  IconWifi
} from '@tabler/icons-react';
import * as THREE from 'three';
import { useGetVoyageQuery, type Cargo } from './api';
import {
  acceptComment,
  acceptLimit,
  addComment,
  calculateStability,
  detectConflicts,
  fillHatchLoad,
  recordEdit,
  rejectComment,
  selectCargo,
  setViewMode,
  opKindLabel,
  type RootState,
  type StowOp,
  type TerminalId
} from './release';
import ReleasePage from './ReleasePage';

const nav = [
  { path: '/', label: '航次总览', icon: <IconShip size={17} /> },
  { path: '/stowage', label: '配载与货位', icon: <IconLayoutBoardSplit size={17} /> },
  { path: '/release', label: '开航放行', icon: <IconClipboardCheck size={17} /> },
  { path: '/compare', label: '方案对比', icon: <IconHistory size={17} /> },
  { path: '/print', label: '配载图与清单', icon: <IconPrinter size={17} /> }
];

const terminalShort: Record<TerminalId, string> = { shore: '岸基', ship: '船端' };
const terminalName: Record<TerminalId, string> = { shore: '岸基配载员', ship: '船上大副' };

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><small>{eyebrow}</small><h1>{title}</h1><p>{description}</p></div><Group gap="xs">{actions}</Group></div>;
}

function TerminalBanner({ compact = false }: { compact?: boolean }) {
  const state = useSelector((root: RootState) => root.release);
  const terminal = state.terminals[state.activeTerminal];
  const openBatches = state.batches.filter((batch) => batch.terminalId === state.activeTerminal && batch.status !== '已合并' && batch.status !== '已提交').length;
  return <div className={`terminal-banner ${terminal.online ? 'online' : 'offline'}`}>
    <Group gap="xs">
      {terminal.online ? <IconWifi size={15} /> : <IconCloudOff size={15} />}
      <strong>{terminal.label}</strong>
      <Badge size="sm" color={terminal.online ? 'teal' : 'red'} variant="light">{terminal.online ? '在线' : '断网 · 改动保留本地批次'}</Badge>
      {state.snapshot && <Badge size="sm" color="teal" variant="light" leftSection={<IconLock size={10} />}>快照 V{state.snapshot.revision} 已锁定</Badge>}
      {openBatches > 0 && <Badge size="sm" color="orange" variant="light">{openBatches} 个本地批次</Badge>}
    </Group>
    {!compact && <Text size="xs" c="dimmed">断网期间的货位改动在回网后合并；若快照已锁定，则转入待处理，不覆盖锁定快照。</Text>}
  </div>;
}

function ThreeHold({ compact = false }: { compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeTerminal = useSelector((root: RootState) => root.release.activeTerminal);
  const cargo = useSelector((root: RootState) => root.release.drafts[root.release.activeTerminal]);
  const activeId = useSelector((root: RootState) => root.release.activeCargoId);
  const dispatch = useDispatch();
  const [rotation, setRotation] = useState({ theta: .65, phi: 1.05 });
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dce7e3');
    scene.fog = new THREE.Fog('#dce7e3', 38, 88);
    const camera = new THREE.PerspectiveCamera(36, 1, .1, 200);
    scene.add(new THREE.HemisphereLight('#ffffff', '#4b625b', 2.4));
    const light = new THREE.DirectionalLight('#fff5dd', 3.3);
    light.position.set(22, 38, 20);
    light.castShadow = true;
    scene.add(light);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), new THREE.MeshStandardMaterial({ color: '#4c7c86', roughness: .72 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -.15;
    scene.add(water);
    const hullMat = new THREE.MeshStandardMaterial({ color: '#214c46', roughness: .55, metalness: .18 });
    const deckMat = new THREE.MeshStandardMaterial({ color: '#8b928d', roughness: .9 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(56, 5.5, 18), hullMat);
    hull.position.y = 2.2;
    hull.castShadow = true;
    scene.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(56, .45, 18), deckMat);
    deck.position.y = 5.15;
    deck.receiveShadow = true;
    scene.add(deck);
    for (let x = -24; x <= 24; x += 4) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(.08, .06, 18), new THREE.MeshBasicMaterial({ color: '#b8c8c3' }));
      line.position.set(x, 5.4, 0);
      scene.add(line);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(8, 7, 14), new THREE.MeshStandardMaterial({ color: '#e6e5df' }));
    bridge.position.set(21, 8.7, 0);
    scene.add(bridge);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 4, 16), new THREE.MeshStandardMaterial({ color: '#c26843' }));
    stack.position.set(18, 14.2, 0);
    scene.add(stack);
    const boxes: THREE.Mesh[] = [];
    cargo.filter((item) => item.type === '集装箱').forEach((item) => {
      const geometry = item.dimension.startsWith('20') ? new THREE.BoxGeometry(2.35, 2.3, 2.3) : new THREE.BoxGeometry(4.5, 2.3, 2.3);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: item.color, roughness: .68 }));
      mesh.position.set((item.bay - 20) * 2.2, item.deck === '主甲板' ? 6.7 + item.tier * 2.45 : 2.1 + item.tier * 2.45, (item.row - 4) * 2.5);
      mesh.castShadow = true;
      mesh.userData.id = item.id;
      boxes.push(mesh);
      scene.add(mesh);
    });
    const heavy = cargo.find((item) => item.type === '重大件');
    if (heavy) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(9.5, 2.4, 3), new THREE.MeshStandardMaterial({ color: heavy.color }));
      mesh.position.set((heavy.bay - 20) * 2.2, 6.7, 1.2);
      mesh.userData.id = heavy.id;
      boxes.push(mesh);
      scene.add(mesh);
      const center = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, 8.5, 12), new THREE.MeshStandardMaterial({ color: '#e9b54d' }));
      center.position.set((heavy.bay - 20) * 2.2, 7.95, 1.2);
      center.rotation.z = Math.PI / 2;
      scene.add(center);
    }
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let theta = .65;
    let phi = 1.05;
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    const onDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      theta += (event.clientX - lastX) * .007;
      phi = Math.max(.5, Math.min(1.55, phi + (event.clientY - lastY) * .005));
      lastX = event.clientX;
      lastY = event.clientY;
      setRotation({ theta, phi });
    };
    const onUp = (event: PointerEvent) => {
      dragging = false;
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(boxes)[0];
      if (hit?.object.userData.id) dispatch(selectCargo(String(hit.object.userData.id)));
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      const radius = compact ? 68 : 61;
      camera.position.set(Math.sin(theta) * Math.sin(phi) * radius, Math.cos(phi) * radius + 15, Math.cos(theta) * Math.sin(phi) * radius);
      camera.lookAt(0, 7, 0);
      boxes.forEach((box) => { box.material = box.material as THREE.MeshStandardMaterial; (box.material as THREE.MeshStandardMaterial).emissive = box.userData.id === activeId ? new THREE.Color('#1a5c4b') : new THREE.Color('#000000'); });
      renderer.render(scene, camera);
    };
    render();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      renderer.dispose();
    };
  }, [activeId, cargo, compact, dispatch, activeTerminal]);
  return <div ref={containerRef} className="three-hold"><canvas ref={canvasRef} /><div className="three-legend"><span><i style={{ background: '#2b7c75' }} />集装箱</span><span><i style={{ background: '#b64f49' }} />重大件</span><span><i style={{ background: '#e9b54d' }} />吊点</span></div><div className="three-hint">拖动旋转 · 点击货箱选择</div><div className="orientation">艏 <span>→</span> 艉</div></div>;
}

function SectionView() {
  const cargo = useSelector((root: RootState) => root.release.drafts[root.release.activeTerminal]);
  const dispatch = useDispatch();
  return <div className="section-view"><div className="section-labels"><span>第 3 层</span><span>第 2 层</span><span>第 1 层</span><span>舱底</span></div><div className="section-grid">{Array.from({ length: 9 * 4 }).map((_, index) => { const tier = 4 - Math.floor(index / 9); const row = index % 9; const item = cargo.find((cargoItem) => cargoItem.tier === tier && cargoItem.row === row); return <button key={index} className={item ? 'occupied' : ''} style={item ? { background: item.color } : undefined} onClick={() => item && dispatch(selectCargo(item.id))} title={item ? `${item.id} · ${item.weight}t` : `空货位 R${row} T${tier}`}>{item?.bill.slice(-3)}</button>; })}</div><div className="section-axis">舱内横向剖面 · 鼠标悬停查看重量</div></div>;
}

function Overview() {
  const state = useSelector((root: RootState) => root.release);
  const { data } = useGetVoyageQuery();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const cargo = state.drafts[state.activeTerminal];
  const stability = calculateStability(cargo);
  const conflicts = detectConflicts(cargo);
  const active = cargo.find((item) => item.id === state.activeCargoId) ?? cargo[0];
  const terminal = state.terminals[state.activeTerminal];
  return <div className="page">
    <PageHeading eyebrow={`${data?.id ?? 'V-2609-17'} / 航次审阅`} title="多用途船舶配载校核" description={`${data?.vessel ?? '海岳轮'} · ${data?.route ?? '上海 → 釜山 → 温哥华'} · 计划离港 ${data?.departure ?? '10-02 14:00'}`} actions={<><Button variant="default" leftSection={<IconRefresh size={16} />} onClick={() => dispatch(setViewMode(state.viewMode === '3d' ? 'section' : '3d'))}>{state.viewMode === '3d' ? '二维剖面' : '三维视角'}</Button><Button color="teal" leftSection={<IconClipboardCheck size={16} />} onClick={() => navigate('/release')}>前往开航放行</Button></>} />
    <TerminalBanner />
    {conflicts.length > 0 && <div className="warning-banner"><IconAlertTriangle size={18} /><strong>{conflicts.length} 项配载冲突待处理</strong><span>{conflicts.map((item) => item.title).join('、')}</span></div>}
    <SimpleGrid cols={{ base: 2, lg: 4 }} spacing="sm" mb="md">{[
      ['总货重', `${stability.total.toFixed(1)} t`, '设计上限 3560 t', 'ok'],
      ['稳性裕度', `${stability.stability.toFixed(1)}%`, stability.stability > 70 ? '符合航次要求' : '低于控制线 · 放行将重算为不通过', stability.stability > 70 ? 'ok' : 'bad'],
      ['纵倾状态', stability.trim, `Lcg ${stability.longitudinal.toFixed(2)} m`, 'ok'],
      ['主甲板载荷', `${stability.deckLoad.toFixed(1)} t`, '局部强度已校核', 'ok']
    ].map((item) => <Card key={item[0]} padding="md" className="metric-card"><Text size="xs" c="dimmed">{item[0]}</Text><Text fw={800} fz={23} mt={3}>{item[1]}</Text><Text size="xs" c={item[3] === 'bad' ? 'red' : 'teal'}>{item[2]}</Text></Card>)}</SimpleGrid>
    <div className="overview-grid">
      <Card padding={0} className="scene-card"><div className="panel-title"><div><strong>{state.viewMode === '3d' ? '三维货位与航次分布' : '舱内横向剖面'}</strong><Text size="xs" c="dimmed">货箱颜色对应目的港与货类 · 当前为{terminalName[state.activeTerminal]}草稿</Text></div><Group gap="xs"><Badge color={terminal.status === 'cleared' ? 'teal' : 'orange'} variant="light">{terminal.status === 'cleared' ? `已放行 ${terminal.ack?.docNo ?? ''}` : '草稿未放行'}</Badge><Badge color="teal" variant="light">V{terminal.revision}</Badge></Group></div>{state.viewMode === '3d' ? <ThreeHold /> : <SectionView />}</Card>
      <Stack gap="sm">
        <Card padding="md"><div className="panel-title"><div><strong>当前货位</strong><Text size="xs" c="dimmed">{active.id}</Text></div><Badge color={active.hazmat !== '无' ? 'orange' : 'gray'}>{active.hazmat === '无' ? '普通货' : '危险品'}</Badge></div><Stack gap={6} mt="sm"><Text fw={700}>{active.bill} · {active.type}</Text><Text size="xs" c="dimmed">{active.dimension}</Text><SimpleGrid cols={2} spacing="xs"><div className="mini-stat"><span>重量</span><strong>{active.weight} t</strong></div><div className="mini-stat"><span>卸货港</span><strong>{active.port}</strong></div><div className="mini-stat"><span>货位</span><strong>Bay {active.bay} / Row {active.row} / Tier {active.tier}</strong></div><div className="mini-stat"><span>绑扎点</span><strong>{active.appliedLashPoints}/{active.requiredLashPoints} · {active.lashing}</strong></div><div className="mini-stat"><span>隔离距离</span><strong>{active.hazmat === '无' ? '—' : `${active.dgDistance.toFixed(1)} m`}</strong></div><div className="mini-stat"><span>承重记录</span><strong>{active.hatchLoadRecorded ? active.hatchId ?? '已记录' : '缺失 · 待补齐'}</strong></div></SimpleGrid></Stack></Card>
        <Card padding="md"><div className="panel-title"><div><strong>重量分布</strong><Text size="xs" c="dimmed">按横向货位统计</Text></div><IconRulerMeasure size={18} /></div><div className="weight-bars">{[2, 4, 6, 8, 10, 12, 14].map((bay) => { const weight = cargo.filter((item) => item.bay === bay).reduce((sum, item) => sum + item.weight, 0); return <div key={bay}><span>{weight.toFixed(0)}t</span><i style={{ height: `${Math.max(8, weight / 1.2)}px` }} /><small>B{bay}</small></div>; })}</div></Card>
        <Card padding="md"><div className="panel-title"><div><strong>角色限制条件</strong><Text size="xs" c="dimmed">{state.comments.filter((item) => item.status === '待确认').length} 项待确认</Text></div><IconUsers size={18} /></div>{state.comments.slice(0, 3).map((comment) => <div className="limit-row" key={comment.id}><div><Text size="xs" fw={700}>{comment.author} · {comment.role}</Text><Text size="xs" c="dimmed">{comment.content}</Text></div><Badge size="xs" color={comment.status === '待确认' ? 'orange' : 'teal'}>{comment.status}</Badge></div>)}</Card>
      </Stack>
    </div>
  </div>;
}

function Stowage() {
  const state = useSelector((root: RootState) => root.release);
  const dispatch = useDispatch();
  const cargo = state.drafts[state.activeTerminal];
  const terminal = state.terminals[state.activeTerminal];
  const active = cargo.find((item) => item.id === state.activeCargoId) ?? cargo[0];
  const conflicts = detectConflicts(cargo);
  const stability = calculateStability(cargo);
  const [bay, setBay] = useState(active.bay);
  const [row, setRow] = useState(active.row);
  const [tier, setTier] = useState(active.tier);
  const [dragId, setDragId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  useEffect(() => { setBay(active.bay); setRow(active.row); setTier(active.tier); }, [active.bay, active.row, active.tier]);
  const slots = useMemo(() => Array.from({ length: 28 }).map((_, index) => ({ id: `slot-${index}`, bay: 4 + Math.floor(index / 4), row: index % 4, tier: 0, label: `B${4 + Math.floor(index / 4)} R${index % 4}` })), []);
  const sendOp = (op: StowOp) => dispatch(recordEdit({ op }));
  return <div className="page">
    <PageHeading eyebrow={`配载工作区 / ${terminalName[state.activeTerminal]} V${terminal.revision}`} title="货位安排与冲突校核" description="拖动货箱或精确调整货位；危险品隔离、绑扎点、舱盖板承重任一改动，稳性与放行结论立即重算。" actions={<Badge size="lg" color={conflicts.length ? 'orange' : 'teal'} leftSection={<IconCheck size={14} />}>{conflicts.length ? `${conflicts.length} 项冲突` : '校验通过'}</Badge>} />
    <TerminalBanner />
    {!active.hatchLoadRecorded && <div className="warning-banner"><IconAlertTriangle size={18} /><strong>{active.bill} 为旧草稿导入货物，缺少舱盖板/舱底承重记录</strong><span>请在右侧“承重记录补齐”处录入承载位与承压面积，补齐前禁止重排。</span></div>}
    {state.snapshot && <div className="warning-banner locked"><IconLock size={18} /><strong>放行快照 V{state.snapshot.revision} 已锁定（{terminalName[state.snapshot.winner]}）</strong><span>后续改动不会覆盖快照，将直接进入放行页待处理项。</span></div>}
    <div className="stowage-grid">
      <Card padding={0} className="cargo-list-panel"><div className="panel-title"><div><strong>货物清单</strong><Text size="xs" c="dimmed">{cargo.length} 票 · 可拖拽</Text></div></div><ScrollArea h={600}><div className="cargo-list">{cargo.map((item) => <button draggable onDragStart={() => setDragId(item.id)} key={item.id} className={state.activeCargoId === item.id ? 'active' : ''} onClick={() => dispatch(selectCargo(item.id))}><i style={{ background: item.color }} /><div><strong>{item.bill}{!item.hatchLoadRecorded && <em className="legacy-tag">缺承重</em>}</strong><span>{item.type} · {item.weight}t · {item.port}</span></div><Badge size="xs" color={item.hazmat === '无' ? 'gray' : 'orange'}>{item.hazmat === '无' ? `B${item.bay}` : 'DG'}</Badge></button>)}</div></ScrollArea></Card>
      <Card padding={0} className="deck-panel"><div className="panel-title"><div><strong>主甲板货位图</strong><Text size="xs" c="dimmed">将货物拖入槽位，或点击槽位选择</Text></div><Group gap="xs"><Badge color="teal">稳性 {stability.stability.toFixed(1)}%</Badge><Badge color="gray">{stability.trim}</Badge></Group></div><div className="deck-layout"><div className="bridge-shape">驾驶台</div><div className="slot-grid">{slots.map((slot) => { const occupied = cargo.find((item) => item.deck === '主甲板' && item.bay === slot.bay && item.row === slot.row); return <button key={slot.id} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragId) sendOp({ type: 'stow', id: dragId, bay: slot.bay, row: slot.row, tier: occupied?.tier ?? 1 }); setDragId(null); }} className={occupied ? 'occupied' : ''} style={occupied ? { background: occupied.color } : undefined} onClick={() => { if (occupied) { dispatch(selectCargo(occupied.id)); setRow(slot.row); setBay(slot.bay); } }}><small>{slot.label}</small>{occupied && <strong>{occupied.bill.slice(-3)}<span>{occupied.weight}t</span></strong>}</button>; })}</div><div className="deck-axis">左舷 ← 横向 Row → 右舷</div></div></Card>
      <Stack gap="sm">
        <Card padding="md"><div className="panel-title"><div><strong>精确调整</strong><Text size="xs" c="dimmed">{active.id}</Text></div><IconCube size={18} /></div><Stack gap="sm" mt="md"><NumberInput label="Bay 纵向货位" min={1} max={20} value={bay} onChange={(value) => setBay(Number(value))} /><NumberInput label="Row 横向货位" min={0} max={8} value={row} onChange={(value) => setRow(Number(value))} /><NumberInput label="Tier 堆码层" min={0} max={4} value={tier} onChange={(value) => setTier(Number(value))} /><Button color="teal" disabled={!active.hatchLoadRecorded} title={!active.hatchLoadRecorded ? '旧草稿缺承重记录，补齐后才能重排' : undefined} onClick={() => sendOp({ type: 'stow', id: active.id, bay, row, tier })}>{active.hatchLoadRecorded ? '应用货位调整' : '补齐承重记录后才能重排'}</Button><Divider /><Select label="绑扎状态" data={['已绑扎', '待绑扎', '需复核']} value={active.lashing} onChange={(value) => value && sendOp({ type: 'lashing', id: active.id, lashing: value as Cargo['lashing'], appliedLashPoints: active.appliedLashPoints })} /><NumberInput label={`绑扎点（要求 ${active.requiredLashPoints}）`} min={0} max={16} value={active.appliedLashPoints} onChange={(value) => sendOp({ type: 'lashing', id: active.id, lashing: active.lashing, appliedLashPoints: Number(value) || 0 })} /><NumberInput label={active.hazmat === '无' ? '危险品隔离距离（普通货不适用）' : `危险品隔离距离 m（要求 ≥ 6）`} min={0} max={30} value={active.dgDistance} disabled={active.hazmat === '无'} onChange={(value) => sendOp({ type: 'segregation', id: active.id, dgDistance: Number(value) || 0 })} /></Stack></Card>
        {!active.hatchLoadRecorded && <Card padding="md" className="conflict-card"><div className="panel-title"><div><strong>承重记录补齐</strong><Text size="xs" c="dimmed">旧草稿 · {active.bill}</Text></div><IconRulerMeasure size={18} /></div><LegacyBackfill cargo={active} /></Card>}
        <Card padding="md" className={conflicts.length ? 'conflict-card' : ''}><div className="panel-title"><div><strong>实时冲突</strong><Text size="xs" c="dimmed">重心、稳性、隔离、绑扎与承重</Text></div><IconAlertTriangle size={18} /></div>{conflicts.map((item) => <button className="conflict-row" key={item.id} onClick={() => dispatch(selectCargo(item.cargoId))}><Badge size="xs" color={item.level === 'high' ? 'red' : 'orange'}>{item.level === 'high' ? '阻断' : '预警'}</Badge><div><strong>{item.title}</strong><span>{item.detail}</span></div></button>)}{!conflicts.length && <Text size="sm" c="teal" mt="md">当前草稿未发现货位冲突（放行校核见开航放行页）。</Text>}</Card>
      </Stack>
    </div>
    <Card padding="md" mt="md"><div className="panel-title"><div><strong>角色条件与审批</strong><Text size="xs" c="dimmed">船长、码头和货主代表可对方案提出限制</Text></div><IconUsers size={18} /></div><div className="comments-grid">{state.comments.map((item) => <div className="comment-card" key={item.id}><Group justify="space-between"><Badge size="xs">{item.role}</Badge><Text size="xs" c="dimmed">{item.author}</Text></Group><Text size="sm" mt="xs">{item.content}</Text><Group gap="xs" mt="sm"><Button size="compact-xs" color="teal" disabled={item.status !== '待确认'} onClick={() => dispatch(acceptComment(item.id))}>接受</Button><Button size="compact-xs" variant="default" disabled={item.status !== '待确认'} onClick={() => dispatch(rejectComment(item.id))}>退回</Button></Group></div>)}</div><Group mt="md" align="flex-start"><Textarea flex={1} minRows={2} placeholder="输入新的限制条件或调整意见" value={comment} onChange={(event) => setComment(event.currentTarget.value)} /><Button color="teal" onClick={() => { if (comment.trim()) { dispatch(addComment({ cargoId: active.id, author: terminalName[state.activeTerminal], role: state.activeTerminal === 'ship' ? '船长' : '码头', content: comment })); setComment(''); } }}>提交条件</Button></Group></Card>
  </div>;
}

function LegacyBackfill({ cargo }: { cargo: Cargo }) {
  const dispatch = useDispatch();
  const hatchCovers = useSelector((root: RootState) => root.release.hatchCovers);
  const [hatchId, setHatchId] = useState(cargo.hatchId ?? hatchCovers[0]?.id ?? '');
  const [area, setArea] = useState(cargo.footprintArea);
  return <Stack gap="xs"><Text size="xs" c="dimmed">录入承载舱盖板/舱底与承压面积，补齐后该票恢复可重排，并触发放行结论重算。</Text><Select size="xs" label="承载舱盖板/舱底" data={hatchCovers.map((hatch) => ({ value: hatch.id, label: hatch.label }))} value={hatchId} onChange={(value) => value && setHatchId(value)} /><NumberInput size="xs" label="承压面积 m²" min={1} value={area} onChange={(value) => setArea(Number(value) || 0)} /><Button size="xs" color="teal" leftSection={<IconCheck size={14} />} onClick={() => dispatch(fillHatchLoad({ id: cargo.id, hatchId, footprintArea: area }))}>补齐并允许重排</Button></Stack>;
}

function Compare() {
  const state = useSelector((root: RootState) => root.release);
  const navigate = useNavigate();
  const cargo = state.drafts[state.activeTerminal];
  const stability = calculateStability(cargo);
  const changed = cargo.filter((item) => item.id === 'BL-88247' || item.id === 'BL-88219' || item.id === 'BL-88240');
  const [acceptOpen, setAcceptOpen] = useState(false);
  const dispatch = useDispatch();
  void changed;
  return <div className="page">
    <PageHeading eyebrow="PLAN BASELINE / V4 → V5" title="配载方案对比" description="按货位、重量分布和受限条件比较两个版本；锁定与放行确认统一在“开航放行”页完成。" actions={<Button color="teal" leftSection={<IconCheck size={16} />} onClick={() => setAcceptOpen(true)}>形成审阅结论</Button>} />
    <div className="compare-summary"><div><span>当前版本</span><strong>V{state.planRevision}</strong><small>总重 {stability.total.toFixed(1)}t</small></div><span className="compare-arrow">→</span><div><span>被比较版本</span><strong>V4</strong><small>总重 {(stability.total + 5.2).toFixed(1)}t</small></div><Badge color="teal" variant="light">3 处货位变化</Badge></div>
    <div className="compare-grid"><Card padding={0}><div className="panel-title"><div><strong>V4 基线</strong><Text size="xs" c="dimmed">批准于 09-28 16:20</Text></div></div><div className="mini-deck old-deck">{Array.from({ length: 28 }).map((_, index) => <div key={index} className={index === 6 || index === 11 || index === 17 ? 'changed' : ''}>{index === 6 ? '219' : index === 11 ? '240' : index === 17 ? '247' : ''}</div>)}</div></Card><Card padding={0}><div className="panel-title"><div><strong>V5 候选</strong><Text size="xs" c="dimmed">{terminalName[state.activeTerminal]}编辑 · {state.draftSavedAt}</Text></div></div><div className="mini-deck new-deck">{Array.from({ length: 28 }).map((_, index) => <div key={index} className={index === 6 || index === 11 || index === 17 ? 'changed' : ''}>{index === 6 ? '219' : index === 11 ? '240' : index === 17 ? '247' : ''}</div>)}</div></Card></div>
    <Card padding="md" mt="md"><div className="panel-title"><div><strong>参数差异</strong><Text size="xs" c="dimmed">隔离、绑扎或承重改动后，稳性与放行结论立即重算</Text></div><Badge>3 项</Badge></div><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>货物</Table.Th><Table.Th>字段</Table.Th><Table.Th>V4</Table.Th><Table.Th>V5</Table.Th><Table.Th>说明</Table.Th><Table.Th>决定</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{[
      ['BL-88247', '货位', 'Bay 14 / Row 1', 'Bay 15 / Row 0', '扩大重大件绑扎操作空间'],
      ['BL-88219', '绑扎', '待绑扎', '需复核', '危险品隔离边界调整'],
      ['BL-88240', 'Tier', 'Tier 1', 'Tier 2', '降低舱内底层局部载荷']
    ].map((row) => <Table.Tr key={row[0]}><Table.Td>{row[0]}</Table.Td><Table.Td>{row[1]}</Table.Td><Table.Td><Text c="red" td="line-through">{row[2]}</Text></Table.Td><Table.Td><Text c="teal" fw={700}>{row[3]}</Text></Table.Td><Table.Td><Text size="xs">{row[4]}</Text></Table.Td><Table.Td><Checkbox label="接受" defaultChecked /></Table.Td></Table.Tr>)}</Table.Tbody></Table></Card>
    <Modal opened={acceptOpen} onClose={() => setAcceptOpen(false)} title="形成配载审阅结论" centered><Stack><Text size="sm" c="dimmed">勾选后前往开航放行页完成确认；先确认的一版锁定快照，落选差异进入待处理。</Text>{['重大件绑扎后由甲板部复核', '危险品隔离线在配载图中明确标注', '釜山卸货顺序不得改变'].map((limit) => <Checkbox key={limit} label={limit} checked={state.acceptedLimits.includes(limit)} onChange={() => dispatch(acceptLimit(limit))} />)}<Button color="teal" leftSection={<IconClipboardCheck size={16} />} onClick={() => { setAcceptOpen(false); navigate('/release'); }}>前往开航放行确认</Button></Stack></Modal>
  </div>;
}

function PrintPlan() {
  const { data } = useGetVoyageQuery();
  const state = useSelector((root: RootState) => root.release);
  const cargo = state.drafts[state.activeTerminal];
  const terminal = state.terminals[state.activeTerminal];
  const stability = calculateStability(cargo);
  const conflicts = detectConflicts(cargo);
  const openPending = state.pending.filter((item) => item.status === '待处理');
  const openBatches = state.batches.filter((batch) => batch.terminalId === state.activeTerminal && (batch.status === '本地保留' || batch.status === '失败待重试'));
  const checks: [string, boolean, string][] = [
    ['稳性与纵倾', stability.stability >= 70, `稳性 ${stability.stability.toFixed(1)}% · ${stability.trim}`],
    ['货位与堆码', conflicts.length === 0, conflicts.length ? conflicts.map((c) => c.title).join('；') : '无重叠 / 无堆重超限'],
    ['危险品隔离', cargo.every((item) => item.hazmat === '无' || item.dgDistance >= 6), '在船危险品隔离距离 ≥ 6m'],
    ['绑扎点', cargo.every((item) => item.appliedLashPoints >= item.requiredLashPoints), '各票绑扎点数量满足方案要求'],
    ['舱盖板承重', cargo.every((item) => item.hatchLoadRecorded), cargo.some((item) => !item.hatchLoadRecorded) ? `缺承重记录：${cargo.filter((item) => !item.hatchLoadRecorded).map((item) => item.bill).join('、')}` : '承重记录齐全，压强/合计在限值内'],
    ['待处理项', openPending.length === 0, openPending.length ? `${openPending.length} 项待处理（含来源）` : '无待处理项'],
    ['链路与批次', terminal.online && openBatches.length === 0, terminal.online ? (openBatches.length ? `${openBatches.length} 个本地批次未完成` : '链路在线') : '终端断网，本地批次未合并']
  ];
  const cleared = terminal.status === 'cleared' && terminal.ack;
  return <div className="page print-page">
    <PageHeading eyebrow="STOWAGE PLAN / PRINT" title="配载图与卸货清单" description="面向船长、码头和理货人员打印；包含放行校核、待处理项及来源、本地批次状态。未核放行仅以草稿打印。" actions={<Button color="teal" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>打印配载包</Button>} />
    <Card padding="xl" className="print-sheet">
      <div className="print-header"><div><Text size="xs" c="dimmed">VESSEL STOWAGE PLAN</Text><h1>{data?.vessel ?? '海岳轮'} · {data?.id ?? 'V-2609-17'}</h1><p>{data?.route}</p></div><div className={`print-stamp ${cleared ? '' : 'draft'}`}>{cleared ? <>放行书 {terminal.ack!.docNo}<br />回执 {terminal.ack!.ackId}<br />V{terminal.ack!.revision} 已锁定</> : <>草稿（未核）<br />{terminal.online ? '放行待确认' : '断网 · 批次未合并'}<br />不得开航</>}</div></div>
      <div className="print-meta"><span>确认终端：{terminal.label}（{terminalName[state.activeTerminal]}）</span><span>打印时间：{new Date().toLocaleString('zh-CN', { hour12: false })}</span>{state.snapshot && <span>锁定快照：V{state.snapshot.revision} · {terminalName[state.snapshot.winner]} · {state.snapshot.lockedAt}</span>}</div>
      <div className="print-kpis"><div><span>总货重</span><strong>{stability.total.toFixed(1)} t</strong></div><div><span>稳性裕度</span><strong>{stability.stability.toFixed(1)}%</strong></div><div><span>纵倾</span><strong>{stability.trim}</strong></div><div><span>主甲板载荷</span><strong>{stability.deckLoad.toFixed(1)} t</strong></div></div>

      <h3>开航放行校核结论{cleared ? <em className="section-tag pass">已通过</em> : <em className="section-tag hold">未核 · 停在草稿</em>}</h3>
      <Table striped className="print-checks"><Table.Thead><Table.Tr><Table.Th>校核项</Table.Th><Table.Th>结论</Table.Th><Table.Th>说明</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{checks.map(([label, pass, detail]) => <Table.Tr key={label}><Table.Td>{label}</Table.Td><Table.Td><b style={{ color: pass ? '#1f7063' : '#b64440' }}>{pass ? '通过' : '未通过'}</b></Table.Td><Table.Td>{detail}</Table.Td></Table.Tr>)}</Table.Tbody></Table>

      <h3>待处理项及来源{openPending.length > 0 && <em className="section-tag hold">{openPending.length} 项待处理</em>}</h3>
      <Table striped><Table.Thead><Table.Tr><Table.Th>来源终端</Table.Th><Table.Th>产生原因</Table.Th><Table.Th>提单号 / 类别</Table.Th><Table.Th>内容</Table.Th><Table.Th>状态</Table.Th></Table.Tr></Table.Thead><Table.Tbody>
        {openPending.length === 0 && <Table.Tr><Table.Td colSpan={5}>无待处理项。</Table.Td></Table.Tr>}
        {openPending.map((item) => <Table.Tr key={item.id}><Table.Td>{terminalName[item.sourceTerminal]}</Table.Td><Table.Td>{item.reason}</Table.Td><Table.Td>{item.bill} · {opKindLabel[item.opKind as StowOp['type']] ?? '放行'}</Table.Td><Table.Td>{item.detail}</Table.Td><Table.Td>{item.status}</Table.Td></Table.Tr>)}
      </Table.Tbody></Table>

      <h3>本地批次（断网保留 / 写入失败待重试）</h3>
      <Table striped><Table.Thead><Table.Tr><Table.Th>批次</Table.Th><Table.Th>终端</Table.Th><Table.Th>原提单号</Table.Th><Table.Th>内容</Table.Th><Table.Th>状态</Table.Th></Table.Tr></Table.Thead><Table.Tbody>
        {state.batches.filter((batch) => batch.terminalId === state.activeTerminal).length === 0 && <Table.Tr><Table.Td colSpan={5}>无本地批次。</Table.Td></Table.Tr>}
        {state.batches.filter((batch) => batch.terminalId === state.activeTerminal).map((batch) => <Table.Tr key={batch.id}><Table.Td>{batch.id.slice(-6).toUpperCase()}</Table.Td><Table.Td>{terminalShort[batch.terminalId]}</Table.Td><Table.Td>{batch.kind === 'release' ? batch.anchorBill : '编辑批次'}</Table.Td><Table.Td>{batch.kind === 'edit' ? `${batch.ops.length} 项改动（基线 V${batch.baseRevision}）` : '放行写入'}{batch.error ? ` · ${batch.error}` : ''}</Table.Td><Table.Td>{batch.status}</Table.Td></Table.Tr>)}
      </Table.Tbody></Table>

      <h3>主甲板配载图</h3>
      <div className="print-deck">{Array.from({ length: 28 }).map((_, index) => { const row = index % 4; const bay = 4 + Math.floor(index / 4); const item = cargo.find((cargo) => cargo.deck === '主甲板' && cargo.bay === bay && cargo.row === row); return <div key={index} className={item ? 'filled' : ''} style={item ? { borderTopColor: item.color } : undefined}><span>{item ? item.bill.slice(-3) : ''}</span><small>{item ? `${item.weight}t` : `B${bay}/R${row}`}</small>{item?.hazmat !== '无' && item && <b>DG</b>}{item && !item.hatchLoadRecorded && <em className="load-missing">缺承重</em>}</div>; })}</div>
      <h3>卸货顺序与绑扎清单</h3>
      <Table striped><Table.Thead><Table.Tr><Table.Th>顺序</Table.Th><Table.Th>提单号</Table.Th><Table.Th>货位</Table.Th><Table.Th>货类</Table.Th><Table.Th>重量</Table.Th><Table.Th>卸货港</Table.Th><Table.Th>危险品/隔离</Table.Th><Table.Th>绑扎点/状态</Table.Th><Table.Th>承重记录</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{[...cargo].sort((a, b) => (a.port === '釜山' ? -1 : 1) - (b.port === '釜山' ? -1 : 1)).map((item, index) => <Table.Tr key={item.id}><Table.Td>{index + 1}</Table.Td><Table.Td fw={700}>{item.bill}</Table.Td><Table.Td>B{item.bay}/R{item.row}/T{item.tier}</Table.Td><Table.Td>{item.type}</Table.Td><Table.Td>{item.weight} t</Table.Td><Table.Td>{item.port}</Table.Td><Table.Td>{item.hazmat === '无' ? '—' : `${item.hazmat} / ${item.dgDistance.toFixed(1)}m`}</Table.Td><Table.Td>{item.appliedLashPoints}/{item.requiredLashPoints} · {item.lashing}</Table.Td><Table.Td>{item.hatchLoadRecorded ? item.hatchId : <b style={{ color: '#b64440' }}>缺失待补</b>}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
      <div className="print-signatures"><div>配载负责人：____________</div><div>船长确认：____________</div><div>码头代表：____________</div><div>日期：2026-10-04</div></div>
    </Card>
  </div>;
}

function Shell({ children }: { children: ReactNode }) {
  const state = useSelector((root: RootState) => root.release);
  const cargo = state.drafts[state.activeTerminal];
  const stability = calculateStability(cargo);
  const terminal = state.terminals[state.activeTerminal];
  const pendingOpen = state.pending.filter((item) => item.status === '待处理').length;
  return <AppShell header={{ height: 62 }} navbar={{ width: 224, breakpoint: 'sm' }} padding={0}>
    <AppShellHeader className="app-header"><Group h="100%" px="md" justify="space-between"><Group gap="sm"><ThemeIcon color="teal" variant="light"><IconShip size={19} /></ThemeIcon><div className="brand-copy"><strong>船舶配载校核台</strong><span>Stowage & Voyage Review</span></div></Group><Group gap="sm" visibleFrom="sm"><Badge variant="light" color="teal">海岳轮</Badge><Text size="xs" c="dimmed">V-2609-17 · {terminalShort[state.activeTerminal]} V{terminal.revision}</Text><Badge color={state.snapshot ? 'teal' : 'orange'} leftSection={state.snapshot ? <IconLock size={11} /> : undefined}>{state.snapshot ? `已放行 V${state.snapshot.revision}` : '草稿审阅中'}</Badge>{pendingOpen > 0 && <Badge color="orange">{pendingOpen} 待处理</Badge>}{!terminal.online && <Badge color="red" leftSection={<IconCloudOff size={11} />}>断网</Badge>}</Group><ActionIcon variant="subtle" color="gray"><IconAnchor size={18} /></ActionIcon></Group></AppShellHeader>
    <AppShellNavbar p="xs" className="app-nav"><div className="voyage-card"><Text size="xs" c="dimmed">当前视角</Text><Text fw={800}>{terminal.label}</Text><Text size="xs" c="dimmed">{state.terminals.shore.online && state.terminals.ship.online ? '两终端在线协同' : '存在断网终端 · 回网合并'}</Text><Progress value={stability.stability} color={stability.stability > 70 ? 'teal' : 'orange'} size="sm" mt="sm" /><Text size="xs" mt={4}>稳性裕度 {stability.stability.toFixed(1)}%</Text></div>{nav.map((item) => <NavLink end={item.path === '/'} key={item.path} to={item.path}>{item.icon}<span>{item.label}</span>{item.path === '/release' && pendingOpen > 0 && <em className="nav-badge">{pendingOpen}</em>}</NavLink>)}<div className="nav-foot"><IconRoute size={16} /><Text size="xs">基线：方案 V4<br />草稿：{state.draftSavedAt} 自动保存</Text></div></AppShellNavbar>
    <AppShellMain>{children}</AppShellMain>
  </AppShell>;
}

export default function App() {
  return <BrowserRouter><Shell><Routes><Route path="/" element={<Overview />} /><Route path="/stowage" element={<Stowage />} /><Route path="/release" element={<ReleasePage />} /><Route path="/compare" element={<Compare />} /><Route path="/print" element={<PrintPlan />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Shell></BrowserRouter>;
}
