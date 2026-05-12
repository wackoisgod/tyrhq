<script lang="ts">
	import { env } from '$env/dynamic/public';
	import { getAbsoluteUrl } from '$lib/site-url';
	import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
	import { onMount, tick } from 'svelte';

	import {
		applyPlannerOperation,
		buildCompactState,
		clonePlannerState,
		createPlannerId,
		parseCompactState,
		type CompactState,
		type LineEnd,
		type LineStyle,
		type PlannerOperation,
		type PlannerOperationEnvelope,
		type PlannerParticipantPresence,
		type PlannerState,
		type Point,
		type ShapeDraft,
		type ShapeEntry,
		type ShapeKind,
		type StampEntry,
		type StampType,
		type Stroke
	} from '$lib/maps/planner';

	type TankInfo = { id: string; name: string; classId: string; vision: number };
	type ToolMode = 'pen' | 'eraser' | 'stamp' | 'shape';
	type DrawerSection = 'style' | 'markers' | 'actions' | null;
	type PlannerSnapshot = PlannerState;
	type MapRoomConfig = {
		token: string;
		title: string;
		initialState: CompactState;
		isHost: boolean;
	};
	type CurrentUserIdentity = { id: string; displayName: string } | null;
	type RoomConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
	type AvailableMap = { slug: string; name: string };

	let {
		minimapSrc,
		mapName,
		mapSlug,
		tanks,
		availableMaps = [],
		mapMeters = 1000,
		room = null,
		currentUser = null
	}: {
		minimapSrc: string;
		mapName: string;
		mapSlug: string;
		tanks: TankInfo[];
		availableMaps?: AvailableMap[];
		mapMeters?: number;
		room?: MapRoomConfig | null;
		currentUser?: CurrentUserIdentity;
	} = $props();

	const colors = ['#ef4444', '#22c55e', '#3b82f6', '#eab308', '#ffffff'];
	const FRIENDLY_COLOR = '#22c55e';
	const ENEMY_COLOR = '#ef4444';
	const HISTORY_LIMIT = 80;
	const ZOOM_MIN = 1;
	const ZOOM_MAX = 4;
	const ZOOM_STEP = 0.5;
	const STROKE_WIDTH_MULTIPLIER = 25 / 9;
	const BRUSH_MIN_POINT_DISTANCE = 0.0022;
	const BRUSH_PREVIEW_STEP = 0.014;
	const BRUSH_PREVIEW_PULL_MIN = 0.08;
	const BRUSH_PREVIEW_PULL_MAX = 0.38;
	const BRUSH_TRAIL_BLEND = 0.24;
	const PLANNER_STORAGE_PREFIX = 'tyr-hq-map-planner:';
	const ROOM_GUEST_NAME_KEY = 'tyr-hq-map-room-guest-name';
	const ROOM_GUEST_ID_KEY = 'tyr-hq-map-room-guest-id';

	const tbtn =
		'rounded-sm px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition';
	const tbtnTool = `${tbtn} inline-flex items-center gap-1.5 leading-none`;
	const tActive =
		'bg-[var(--hud-teal)]/15 text-[var(--hud-teal)] shadow-[inset_2px_0_0_0_var(--hud-teal)]';
	const tIdle = 'text-[var(--hud-muted)] hover:text-[var(--hud-text)]';
	const toolbarGroup =
		'flex flex-wrap items-center gap-1 rounded-sm bg-[var(--hud-panel)]/72 px-2 py-1 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.18)]';
	const toolGlyph = 'h-3.5 w-3.5 shrink-0';

	const shapeButtons: { kind: ShapeKind; label: string; title: string }[] = [
		{ kind: 'line', label: 'Line', title: 'Straight tactical line' },
		{ kind: 'measure', label: 'Measure', title: 'Distance marker with live readout' },
		{ kind: 'circle', label: 'Ring', title: 'Threat or focus ring' },
		{ kind: 'rectangle', label: 'Box', title: 'Zone or killbox frame' },
		{ kind: 'ping', label: 'Beacon', title: 'Attention beacon' }
	];
	const lineStyleButtons: { value: LineStyle; label: string }[] = [
		{ value: 'solid', label: 'Solid' },
		{ value: 'dashed', label: 'Dash' },
		{ value: 'dotted', label: 'Dot' }
	];
	const lineEndButtons: { value: LineEnd; label: string }[] = [
		{ value: 'none', label: 'None' },
		{ value: 'arrow', label: 'Arrow' },
		{ value: 'stop', label: 'Stop' }
	];

	const stampButtons: { stamp: StampType; side: 'friendly' | 'enemy'; label: string }[] = [
		{ stamp: 'tank', side: 'friendly', label: 'Ally Hull' },
		{ stamp: 'tank', side: 'enemy', label: 'Enemy Hull' },
		{ stamp: 'zone', side: 'friendly', label: 'Ally Zone' },
		{ stamp: 'zone', side: 'enemy', label: 'Enemy Zone' }
	];

	const gridCols = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
	const gridRows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

	let toolMode = $state<ToolMode>('pen');
	let color = $state(colors[0]);
	let lineWidth = $state(3);
	let lineStyle = $state<LineStyle>('solid');
	let lineEnd = $state<LineEnd>('none');
	let activeStamp = $state<StampType>('tank');
	let activeSide = $state<'friendly' | 'enemy'>('friendly');
	let activeShape = $state<ShapeKind>('line');
	let shareStatus = $state<'idle' | 'copied'>('idle');
	let zoom = $state(1);
	let viewportBaseH = $state(0);
	let activeDrawer = $state<DrawerSection>('style');

	let strokes = $state<Stroke[]>([]);
	let stamps = $state<StampEntry[]>([]);
	let shapes = $state<ShapeEntry[]>([]);
	let undoStack = $state<PlannerSnapshot[]>([]);
	let redoStack = $state<PlannerSnapshot[]>([]);
	let currentStroke = $state<Point[] | null>(null);
	let currentShape = $state<ShapeDraft | null>(null);
	let draggingStamp = $state<{
		id: string;
		offsetX: number;
		offsetY: number;
		originalPos: Point;
	} | null>(null);
	let stampDragMoved = $state(false);
	let selectedStampId = $state<string | null>(null);
	let selectedShapeId = $state<string | null>(null);
	let draggingShape = $state<{
		id: string;
		anchor: Point;
		originalStart: Point;
		originalEnd: Point;
	} | null>(null);
	let shapeDragMoved = $state(false);
	let eraserGestureDirty = false;
	let roomConnectionState = $state<RoomConnectionState>('disconnected');
	let roomError = $state<string | null>(null);
	let roomNotice = $state<string | null>(null);
	let liveRoomBusy = $state(false);
	let mapChangeBusy = $state(false);
	let mapChangeSelection = $state('');
	let copyRoomLinkLabel = $state('Copy Room Link');
	let actorId = $state('');
	let actorName = $state('');
	let actorIdentityReady = $state(false);
	let guestNameInput = $state('');
	let participants = $state<PlannerParticipantPresence[]>([]);

	let containerEl: HTMLDivElement;
	let canvasEl: HTMLCanvasElement;
	let imgEl: HTMLImageElement;
	let viewportEl: HTMLDivElement;
	let plannerHydrated = $state(false);
	let lastPlannerStorageKey = '';
	let roomChannel = $state<RealtimeChannel | null>(null);
	let roomPresenceJoinedAt = $state('');
	let roomPresenceKey = $state('');

	const vehicleImgCache = new Map<string, HTMLImageElement>();
	const seenRoomEventIds = new Set<string>();

	function getVehicleImg(vehicleId: string): HTMLImageElement {
		if (vehicleImgCache.has(vehicleId)) return vehicleImgCache.get(vehicleId)!;
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.src = `/images/vehicles/${vehicleId}.png`;
		vehicleImgCache.set(vehicleId, img);
		return img;
	}

	$effect(() => {
		for (const tank of tanks) getVehicleImg(tank.id);
	});

	function clampUnit(value: number) {
		return Math.min(1, Math.max(0, value));
	}

	function clampPoint(point: Point): Point {
		return {
			x: clampUnit(point.x),
			y: clampUnit(point.y)
		};
	}

	function formatSvgNumber(value: number) {
		const rounded = Math.round(value * 1000) / 1000;
		return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/\.?0+$/, '');
	}

	function escapeSvgText(value: string) {
		return value
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');
	}

	function withAlpha(hex: string, alpha: number) {
		const normalized = hex.replace('#', '');
		const expanded =
			normalized.length === 3
				? normalized
						.split('')
						.map((char) => `${char}${char}`)
						.join('')
				: normalized;
		const parsed = Number.parseInt(expanded, 16);
		const r = (parsed >> 16) & 255;
		const g = (parsed >> 8) & 255;
		const b = parsed & 255;
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	function distanceBetween(a: Point, b: Point) {
		return Math.hypot(a.x - b.x, a.y - b.y);
	}

	function lerpPoint(start: Point, end: Point, t: number): Point {
		return {
			x: start.x + (end.x - start.x) * t,
			y: start.y + (end.y - start.y) * t
		};
	}

	function appendBrushPoint(points: Point[], rawPoint: Point, finalize = false): Point[] {
		if (points.length === 0) return [rawPoint];

		const last = points[points.length - 1];
		const rawDistance = distanceBetween(last, rawPoint);
		if (rawDistance < BRUSH_MIN_POINT_DISTANCE) return points;

		const responsiveness = Math.min(1, rawDistance / 0.03);
		const pull = finalize
			? 1
			: BRUSH_PREVIEW_PULL_MIN + (BRUSH_PREVIEW_PULL_MAX - BRUSH_PREVIEW_PULL_MIN) * responsiveness;
		const target = finalize ? rawPoint : clampPoint(lerpPoint(last, rawPoint, pull));
		const previous = points.length > 1 ? points[points.length - 2] : last;
		const trailedTarget = finalize
			? target
			: clampPoint({
					x: target.x * (1 - BRUSH_TRAIL_BLEND) + previous.x * BRUSH_TRAIL_BLEND,
					y: target.y * (1 - BRUSH_TRAIL_BLEND) + previous.y * BRUSH_TRAIL_BLEND
				});
		const stepDistance = distanceBetween(last, trailedTarget);
		if (stepDistance < BRUSH_MIN_POINT_DISTANCE) return points;

		const steps = Math.max(1, Math.ceil(stepDistance / BRUSH_PREVIEW_STEP));
		const nextPoints = [...points];
		for (let i = 1; i <= steps; i += 1) {
			nextPoints.push(clampPoint(lerpPoint(last, trailedTarget, i / steps)));
		}

		return nextPoints;
	}

	function drawStrokePath(
		ctx: CanvasRenderingContext2D,
		points: Point[],
		w: number,
		h: number
	) {
		if (points.length === 0) return;

		const scaledPoints = points.map((point) => ({
			x: point.x * w,
			y: point.y * h
		}));

		ctx.moveTo(scaledPoints[0].x, scaledPoints[0].y);

		if (scaledPoints.length === 1) return;
		if (scaledPoints.length === 2) {
			ctx.lineTo(scaledPoints[1].x, scaledPoints[1].y);
			return;
		}

		for (let i = 1; i < scaledPoints.length - 2; i += 1) {
			const current = scaledPoints[i];
			const next = scaledPoints[i + 1];
			const midX = (current.x + next.x) / 2;
			const midY = (current.y + next.y) / 2;
			ctx.quadraticCurveTo(current.x, current.y, midX, midY);
		}

		const penultimate = scaledPoints[scaledPoints.length - 2];
		const last = scaledPoints[scaledPoints.length - 1];
		ctx.quadraticCurveTo(penultimate.x, penultimate.y, last.x, last.y);
	}

	function getStrokeTerminalSegment(points: Point[], atStart = false) {
		if (points.length < 2) return null;
		if (atStart) {
			const anchor = points[0];
			for (let i = 1; i < points.length; i += 1) {
				if (distanceBetween(anchor, points[i]) >= BRUSH_MIN_POINT_DISTANCE) {
					return { from: anchor, to: points[i] };
				}
			}
			return null;
		}

		const anchor = points[points.length - 1];
		for (let i = points.length - 2; i >= 0; i -= 1) {
			if (distanceBetween(anchor, points[i]) >= BRUSH_MIN_POINT_DISTANCE) {
				return { from: points[i], to: anchor };
			}
		}
		return null;
	}

	function getPointerPos(e: PointerEvent | MouseEvent): Point {
		const rect = containerEl.getBoundingClientRect();
		return clampPoint({
			x: (e.clientX - rect.left) / rect.width,
			y: (e.clientY - rect.top) / rect.height
		});
	}

	function getCanvasPointerPos(e: PointerEvent): Point {
		const rect = canvasEl.getBoundingClientRect();
		return clampPoint({
			x: (e.clientX - rect.left) / rect.width,
			y: (e.clientY - rect.top) / rect.height
		});
	}

	function cloneStrokes(value: Stroke[]): Stroke[] {
		return value.map((stroke) => ({
			...stroke,
			points: stroke.points.map((point) => ({ ...point }))
		}));
	}

	function cloneStamps(value: StampEntry[]): StampEntry[] {
		return value.map((stamp) => ({ ...stamp, pos: { ...stamp.pos } }));
	}

	function cloneShapes(value: ShapeEntry[]): ShapeEntry[] {
		return value.map((shape) => ({
			...shape,
			start: { ...shape.start },
			end: { ...shape.end }
		}));
	}

	function getPlannerStorageKey() {
		return `${PLANNER_STORAGE_PREFIX}${minimapSrc}`;
	}

	function resetPlannerState({ resetZoom = false, redraw = true } = {}) {
		strokes = [];
		stamps = [];
		shapes = [];
		undoStack = [];
		redoStack = [];
		currentStroke = null;
		currentShape = null;
		draggingStamp = null;
		stampDragMoved = false;
		selectedStampId = null;
		selectedShapeId = null;
		draggingShape = null;
		shapeDragMoved = false;
		eraserGestureDirty = false;
		shareStatus = 'idle';
		if (resetZoom) zoom = 1;
		if (redraw) redrawAll();
	}

	function snapshotCurrent(): PlannerSnapshot {
		return clonePlannerState({
			strokes,
			stamps,
			shapes
		});
	}

	function restoreSnapshot(snapshot: PlannerSnapshot) {
		strokes = cloneStrokes(snapshot.strokes);
		stamps = cloneStamps(snapshot.stamps);
		shapes = cloneShapes(snapshot.shapes);
		currentStroke = null;
		currentShape = null;
		draggingStamp = null;
		stampDragMoved = false;
		selectedStampId = null;
		selectedShapeId = null;
		draggingShape = null;
		shapeDragMoved = false;
		eraserGestureDirty = false;
		redrawAll();
	}

	function rememberState() {
		undoStack = [...undoStack, snapshotCurrent()].slice(-HISTORY_LIMIT);
		redoStack = [];
	}

	function captureBaseHeight() {
		if (viewportEl && zoom === 1) {
			viewportBaseH = viewportEl.scrollHeight;
		}
	}

	function setZoom(next: number) {
		zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 2) / 2));
	}

	function onZoomWheel(e: WheelEvent) {
		if (!e.ctrlKey && !e.metaKey) return;
		e.preventDefault();
		const oldZoom = zoom;
		const step = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
		setZoom(zoom + step);
		if (zoom === oldZoom) return;

		const viewportRect = viewportEl.getBoundingClientRect();
		const cursorX = e.clientX - viewportRect.left + viewportEl.scrollLeft;
		const cursorY = e.clientY - viewportRect.top + viewportEl.scrollTop;
		const ratio = zoom / oldZoom;

		tick().then(() => {
			viewportEl.scrollLeft = cursorX * ratio - (e.clientX - viewportRect.left);
			viewportEl.scrollTop = cursorY * ratio - (e.clientY - viewportRect.top);
		});
	}

	function trimPointsForArrowEnd(points: Point[], w: number, h: number, strokeWidth: number): Point[] {
		if (points.length < 2) return points;
		const arrowHeadSize = Math.max(12, strokeWidth * 4.6);
		const back = arrowHeadSize * 0.68;
		if (back <= 0) return points;

		let remaining = back;
		const lastIndex = points.length - 1;
		for (let i = lastIndex; i > 0; i -= 1) {
			const next = points[i];
			const prev = points[i - 1];
			const dx = (next.x - prev.x) * w;
			const dy = (next.y - prev.y) * h;
			const segLen = Math.hypot(dx, dy);
			if (segLen <= 0) continue;
			if (segLen >= remaining) {
				const t = remaining / segLen;
				const trimmed = {
					x: next.x - (next.x - prev.x) * t,
					y: next.y - (next.y - prev.y) * t
				};
				return [...points.slice(0, i), trimmed];
			}
			remaining -= segLen;
		}

		return [points[0]];
	}

	function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, w: number, h: number) {
		if (stroke.points.length < 2) return;
		const isPenArrow = stroke.tool === 'pen' && stroke.endType === 'arrow';
		const pointsForCurve = isPenArrow
			? trimPointsForArrowEnd(stroke.points, w, h, stroke.width)
			: stroke.points;

		ctx.save();
		ctx.lineCap = isPenArrow ? 'butt' : 'round';
		ctx.lineJoin = 'round';
		ctx.lineWidth = stroke.width;
		if (stroke.tool === 'eraser') {
			ctx.globalCompositeOperation = 'destination-out';
			ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
		} else {
			ctx.globalCompositeOperation = 'source-over';
			ctx.strokeStyle = stroke.color;
		}
		applyLineStyleToCanvas(ctx, stroke.lineStyle, stroke.width);
		if (pointsForCurve.length >= 2) {
			ctx.beginPath();
			drawStrokePath(ctx, pointsForCurve, w, h);
			ctx.stroke();
		}
		ctx.setLineDash([]);

		if (stroke.tool === 'pen') {
			const tail = getStrokeTerminalSegment(stroke.points);
			if (tail) {
				const start = { x: tail.from.x * w, y: tail.from.y * h };
				const end = { x: tail.to.x * w, y: tail.to.y * h };
				if (stroke.endType === 'arrow') {
					const arrowHeadSize = Math.max(12, stroke.width * 4.6);
					const angle = Math.atan2(end.y - start.y, end.x - start.x);
					ctx.beginPath();
					ctx.moveTo(end.x, end.y);
					ctx.lineTo(
						end.x - arrowHeadSize * Math.cos(angle - Math.PI / 7),
						end.y - arrowHeadSize * Math.sin(angle - Math.PI / 7)
					);
					ctx.lineTo(
						end.x - arrowHeadSize * 0.68 * Math.cos(angle),
						end.y - arrowHeadSize * 0.68 * Math.sin(angle)
					);
					ctx.lineTo(
						end.x - arrowHeadSize * Math.cos(angle + Math.PI / 7),
						end.y - arrowHeadSize * Math.sin(angle + Math.PI / 7)
					);
					ctx.closePath();
					ctx.fillStyle = stroke.color;
					ctx.fill();
				} else if (stroke.endType === 'stop') {
					const dx = end.x - start.x;
					const dy = end.y - start.y;
					const length = Math.hypot(dx, dy);
					if (length > 0) {
						const normalX = -dy / length;
						const normalY = dx / length;
						const stopHalf = Math.max(10, stroke.width * 3.2);
						ctx.beginPath();
						ctx.moveTo(end.x + normalX * stopHalf, end.y + normalY * stopHalf);
						ctx.lineTo(end.x - normalX * stopHalf, end.y - normalY * stopHalf);
						ctx.strokeStyle = stroke.color;
						ctx.lineWidth = Math.max(stroke.width, stroke.width * 0.88);
						ctx.stroke();
					}
				}
			}
		}
		ctx.restore();
	}

	function getShapePixelBounds(shape: ShapeEntry | ShapeDraft, w: number, h: number) {
		const x1 = shape.start.x * w;
		const y1 = shape.start.y * h;
		const x2 = shape.end.x * w;
		const y2 = shape.end.y * h;
		const left = Math.min(x1, x2);
		const top = Math.min(y1, y2);
		const width = Math.abs(x2 - x1);
		const height = Math.abs(y2 - y1);
		return {
			x1,
			y1,
			x2,
			y2,
			left,
			top,
			width,
			height,
			centerX: (x1 + x2) / 2,
			centerY: (y1 + y2) / 2
		};
	}

	function getShapeBounds(shape: ShapeEntry | ShapeDraft) {
		const left = Math.min(shape.start.x, shape.end.x);
		const top = Math.min(shape.start.y, shape.end.y);
		const width = Math.abs(shape.end.x - shape.start.x);
		const height = Math.abs(shape.end.y - shape.start.y);
		return {
			left,
			top,
			width,
			height,
			centerX: (shape.start.x + shape.end.x) / 2,
			centerY: (shape.start.y + shape.end.y) / 2
		};
	}

	function getDevicePixelRatio() {
		return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
	}

	function getConfiguredStrokeWidth(value: number) {
		return value * STROKE_WIDTH_MULTIPLIER;
	}

	function getDisplayLineWidth(width: number) {
		return width / getDevicePixelRatio();
	}

	function getDashSegments(style: LineStyle, width: number): number[] {
		if (style === 'dashed') return [Math.max(10, width * 3.5), Math.max(6, width * 2.4)];
		if (style === 'dotted') return [Math.max(1, width * 0.8), Math.max(7, width * 1.9)];
		return [];
	}

	function applyLineStyleToCanvas(
		ctx: CanvasRenderingContext2D,
		style: LineStyle,
		width: number
	) {
		ctx.setLineDash(getDashSegments(style, width));
	}

	function getSvgDashArray(style: LineStyle, width: number) {
		const segments = getDashSegments(style, width);
		return segments.length > 0 ? segments.join(' ') : undefined;
	}

	function toExportSvgLength(px: number, displayWidth: number) {
		return (px * 1000) / Math.max(displayWidth, 1);
	}

	function getExportSvgDashArray(style: LineStyle, width: number, displayWidth: number) {
		const segments = getDashSegments(style, width).map((segment) =>
			formatSvgNumber(toExportSvgLength(segment, displayWidth))
		);
		return segments.length > 0 ? segments.join(' ') : undefined;
	}

	function getShapeStrokeWidth(shape: ShapeEntry | ShapeDraft) {
		return getDisplayLineWidth(shape.width);
	}

	function getDisplayStrokeWidth(width: number) {
		return getDisplayLineWidth(width);
	}

	function getShapeHitWidth(shape: ShapeEntry | ShapeDraft) {
		return Math.max(18, getShapeStrokeWidth(shape) + 10);
	}

	function getDisplayCanvasSize() {
		const rect = containerEl.getBoundingClientRect();
		return {
			width: Math.max(rect.width, 1),
			height: Math.max(rect.height, 1)
		};
	}

	function toDisplayPoint(point: Point, width: number, height: number): Point {
		return {
			x: point.x * width,
			y: point.y * height
		};
	}

	function distanceToSegment(point: Point, start: Point, end: Point) {
		const dx = end.x - start.x;
		const dy = end.y - start.y;
		if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
		const t = Math.max(
			0,
			Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy))
		);
		const projection = {
			x: start.x + dx * t,
			y: start.y + dy * t
		};
		return Math.hypot(point.x - projection.x, point.y - projection.y);
	}

	function isPointNearPolyline(
		point: Point,
		points: Point[],
		width: number,
		height: number,
		tolerance: number
	) {
		const displayPoint = toDisplayPoint(point, width, height);
		if (points.length === 1) {
			const onlyPoint = toDisplayPoint(points[0], width, height);
			return Math.hypot(displayPoint.x - onlyPoint.x, displayPoint.y - onlyPoint.y) <= tolerance;
		}

		for (let index = 1; index < points.length; index += 1) {
			const start = toDisplayPoint(points[index - 1], width, height);
			const end = toDisplayPoint(points[index], width, height);
			if (distanceToSegment(displayPoint, start, end) <= tolerance) return true;
		}

		return false;
	}

	function isPointInsideEllipse(
		point: Point,
		centerX: number,
		centerY: number,
		radiusX: number,
		radiusY: number
	) {
		if (radiusX <= 0 || radiusY <= 0) return false;
		const dx = point.x - centerX;
		const dy = point.y - centerY;
		return (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY) <= 1;
	}

	function isStrokeHitByEraser(stroke: Stroke, point: Point) {
		if (stroke.tool !== 'pen') return false;
		const { width, height } = getDisplayCanvasSize();
		const tolerance = Math.max(14, getDisplayStrokeWidth(stroke.width) + 10);
		return isPointNearPolyline(point, stroke.points, width, height, tolerance);
	}

	function isStampHitByEraser(stamp: StampEntry, point: Point) {
		const { width, height } = getDisplayCanvasSize();
		const displayPoint = toDisplayPoint(point, width, height);
		const center = toDisplayPoint(stamp.pos, width, height);
		const radius = stamp.stamp === 'tank' ? 28 : 22;
		return Math.hypot(displayPoint.x - center.x, displayPoint.y - center.y) <= radius;
	}

	function isShapeHitByEraser(shape: ShapeEntry, point: Point) {
		const { width, height } = getDisplayCanvasSize();
		const displayPoint = toDisplayPoint(point, width, height);
		const bounds = getShapePixelBounds(shape, width, height);
		const hitWidth = getShapeHitWidth(shape);
		const displayStrokeWidth = getShapeStrokeWidth(shape);

		if (shape.kind === 'line') {
			return (
				distanceToSegment(
					displayPoint,
					toDisplayPoint(shape.start, width, height),
					toDisplayPoint(shape.end, width, height)
				) <= hitWidth
			);
		}

		if (shape.kind === 'measure') {
			const center = toDisplayPoint(shape.start, width, height);
			const edge = toDisplayPoint(shape.end, width, height);
			const radius = getMeasureRadius(shape) * Math.min(width, height);
			const distanceToCenter = Math.hypot(displayPoint.x - center.x, displayPoint.y - center.y);
			return (
				Math.abs(distanceToCenter - radius) <= hitWidth ||
				distanceToSegment(displayPoint, center, edge) <= hitWidth
			);
		}

		if (shape.kind === 'circle') {
			const radiusX = Math.max(bounds.width / 2, displayStrokeWidth * 2.5) + hitWidth;
			const radiusY = Math.max(bounds.height / 2, displayStrokeWidth * 2.5) + hitWidth;
			return isPointInsideEllipse(displayPoint, bounds.centerX, bounds.centerY, radiusX, radiusY);
		}

		if (shape.kind === 'rectangle') {
			const rectWidth = Math.max(bounds.width, displayStrokeWidth * 3);
			const rectHeight = Math.max(bounds.height, displayStrokeWidth * 3);
			const left = bounds.centerX - rectWidth / 2 - hitWidth;
			const top = bounds.centerY - rectHeight / 2 - hitWidth;
			const right = bounds.centerX + rectWidth / 2 + hitWidth;
			const bottom = bounds.centerY + rectHeight / 2 + hitWidth;
			return (
				displayPoint.x >= left &&
				displayPoint.x <= right &&
				displayPoint.y >= top &&
				displayPoint.y <= bottom
			);
		}

		const radius = Math.max(18, Math.hypot(bounds.x2 - bounds.x1, bounds.y2 - bounds.y1)) + hitWidth;
		return Math.hypot(displayPoint.x - bounds.x1, displayPoint.y - bounds.y1) <= radius;
	}

	function eraseAtPoint(point: Point): PlannerOperation | null {
		for (let index = stamps.length - 1; index >= 0; index -= 1) {
			const stamp = stamps[index];
			if (!isStampHitByEraser(stamp, point)) continue;
			return { type: 'delete_stamp', stampId: stamp.id };
		}

		for (let index = shapes.length - 1; index >= 0; index -= 1) {
			const shape = shapes[index];
			if (!isShapeHitByEraser(shape, point)) continue;
			return { type: 'delete_shape', shapeId: shape.id };
		}

		for (let index = strokes.length - 1; index >= 0; index -= 1) {
			if (!isStrokeHitByEraser(strokes[index], point)) continue;
			return { type: 'delete_stroke', strokeId: strokes[index].id };
		}

		return null;
	}

	function getVectorDelta(start: Point, end: Point) {
		return {
			dx: end.x - start.x,
			dy: end.y - start.y
		};
	}

	function getArrowGeometry(start: Point, end: Point, width: number) {
		const displayWidth = getDisplayStrokeWidth(width);
		const length = Math.hypot(end.x - start.x, end.y - start.y);
		if (length < 0.002) return null;

		const angle = Math.atan2(end.y - start.y, end.x - start.x);
		const head = Math.max(0.018, displayWidth * 0.0046);
		const back = head * 0.68;
		return { angle, head, back };
	}

	function getArrowHeadPoints(start: Point, end: Point, width: number) {
		const geometry = getArrowGeometry(start, end, width);
		if (!geometry) return '';

		const { angle, head, back } = geometry;
		const points = [
			end,
			{
				x: end.x - head * Math.cos(angle - Math.PI / 7),
				y: end.y - head * Math.sin(angle - Math.PI / 7)
			},
			{
				x: end.x - back * Math.cos(angle),
				y: end.y - back * Math.sin(angle)
			},
			{
				x: end.x - head * Math.cos(angle + Math.PI / 7),
				y: end.y - head * Math.sin(angle + Math.PI / 7)
			}
		];

		return points
			.map((point) => `${Math.round(point.x * 1000)} ${Math.round(point.y * 1000)}`)
			.join(', ');
	}

	function getLineDrawEnd(shape: { start: Point; end: Point; endType: LineEnd; width: number }): Point {
		if (shape.endType !== 'arrow') return shape.end;
		const geometry = getArrowGeometry(shape.start, shape.end, shape.width);
		if (!geometry) return shape.end;
		const { angle, back } = geometry;
		const length = Math.hypot(shape.end.x - shape.start.x, shape.end.y - shape.start.y);
		const trim = Math.min(back, Math.max(0, length));
		return {
			x: shape.end.x - trim * Math.cos(angle),
			y: shape.end.y - trim * Math.sin(angle)
		};
	}

	function getStopCapSegment(start: Point, end: Point, width: number) {
		const displayWidth = getDisplayStrokeWidth(width);
		const dx = end.x - start.x;
		const dy = end.y - start.y;
		const length = Math.hypot(dx, dy);
		if (length < 0.002) return null;

		const normalX = -dy / length;
		const normalY = dx / length;
		const capHalf = Math.max(0.012, displayWidth * 0.0035);
		return {
			x1: end.x + normalX * capHalf,
			y1: end.y + normalY * capHalf,
			x2: end.x - normalX * capHalf,
			y2: end.y - normalY * capHalf
		};
	}

	function getMeasureRadius(shape: ShapeEntry | ShapeDraft) {
		return Math.max(distanceBetween(shape.start, shape.end), 0.02);
	}

	function getMeasureLabel(shape: ShapeEntry | ShapeDraft) {
		return `${Math.round(getMeasureRadius(shape) * mapMeters)}m`;
	}

	function getMeasureLabelPosition(shape: ShapeEntry | ShapeDraft) {
		const radius = getMeasureRadius(shape);
		return clampPoint({
			x: shape.start.x,
			y: shape.start.y + radius + 0.03
		});
	}

	function toSvgCoord(value: number) {
		return Math.round(value * 1000);
	}

	function getPlannerState(): PlannerState {
		return {
			strokes,
			stamps,
			shapes
		};
	}

	function setPlannerState(nextState: PlannerState, options: { clearHistory?: boolean } = {}) {
		if (options.clearHistory ?? true) {
			resetPlannerState({ redraw: false });
		}
		strokes = cloneStrokes(nextState.strokes);
		stamps = cloneStamps(nextState.stamps);
		shapes = cloneShapes(nextState.shapes);
		redrawAll();
	}

	function applyParsedPlannerState(state: CompactState) {
		setPlannerState(parseCompactState(state));
	}

	function restorePlannerDraft(storageKey: string) {
		if (typeof window === 'undefined') return false;
		const raw = window.localStorage.getItem(storageKey);
		if (!raw) {
			resetPlannerState({ resetZoom: true });
			return false;
		}

		try {
			applyParsedPlannerState(JSON.parse(raw) as CompactState);
			return true;
		} catch {
			window.localStorage.removeItem(storageKey);
			resetPlannerState({ resetZoom: true });
			return false;
		}
	}

	function persistPlannerDraft(storageKey: string) {
		if (typeof window === 'undefined' || !plannerHydrated) return;
		if (strokes.length === 0 && stamps.length === 0 && shapes.length === 0) {
			window.localStorage.removeItem(storageKey);
			return;
		}

		window.localStorage.setItem(storageKey, JSON.stringify(buildCompactState(getPlannerState())));
	}

	function getPreviewPayload() {
		return {
			stroke:
				currentStroke && toolMode !== 'eraser' && currentStroke.length > 0
					? buildPreviewStroke(currentStroke)
					: undefined,
			shape: currentShape ?? undefined
		};
	}

	function redrawPlanner() {
		redrawAll(getPreviewPayload());
	}

	function getRoomUrl() {
		if (!room || typeof window === 'undefined') return '';
		return getAbsoluteUrl(`/maps/${mapSlug}/room/${room.token}`, window.location.origin);
	}

	function getStoredGuestActorId() {
		if (typeof window === 'undefined') return createPlannerId('guest');
		const existing = window.localStorage.getItem(ROOM_GUEST_ID_KEY);
		if (existing) return existing;
		const next = createPlannerId('guest');
		window.localStorage.setItem(ROOM_GUEST_ID_KEY, next);
		return next;
	}

	function hydrateActorIdentity() {
		if (!room) return;
		roomPresenceKey = roomPresenceKey || createPlannerId('event');
		roomPresenceJoinedAt = roomPresenceJoinedAt || new Date().toISOString();
		if (currentUser) {
			actorId = currentUser.id;
			actorName = currentUser.displayName;
			guestNameInput = currentUser.displayName;
			actorIdentityReady = true;
			return;
		}

		if (typeof window === 'undefined') return;
		actorId = getStoredGuestActorId();
		const storedName = window.localStorage.getItem(ROOM_GUEST_NAME_KEY)?.trim() ?? '';
		guestNameInput = storedName;
		actorName = storedName;
		actorIdentityReady = Boolean(storedName);
	}

	function saveGuestIdentity() {
		if (typeof window === 'undefined') return;
		const nextName = guestNameInput.trim();
		if (!nextName) return;
		actorId = getStoredGuestActorId();
		actorName = nextName;
		window.localStorage.setItem(ROOM_GUEST_NAME_KEY, nextName);
		actorIdentityReady = true;
		roomError = null;
	}

	async function copyRoomLink() {
		if (!room) return;
		try {
			await navigator.clipboard.writeText(getRoomUrl());
			copyRoomLinkLabel = 'Copied!';
			setTimeout(() => {
				copyRoomLinkLabel = 'Copy Room Link';
			}, 2000);
		} catch {
			copyRoomLinkLabel = 'Copy failed';
			setTimeout(() => {
				copyRoomLinkLabel = 'Copy Room Link';
			}, 2000);
		}
	}

	async function startLiveRoom() {
		if (!currentUser || liveRoomBusy) return;
		liveRoomBusy = true;
		roomError = null;
		roomNotice = null;

		try {
			const response = await fetch('/api/map-rooms', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mapSlug,
					title: `${mapName} Live Room`,
					state: buildCompactState(getPlannerState())
				})
			});

			if (!response.ok) {
				const body = await response.json().catch(() => ({ message: 'Failed to create live room' }));
				roomError = body.message ?? 'Failed to create live room';
				return;
			}

			const payload = await response.json();
			if (payload.roomUrl) {
				window.location.assign(payload.roomUrl);
			}
		} catch {
			roomError = 'Network error while creating live room.';
		} finally {
			liveRoomBusy = false;
		}
	}

	async function refreshRoomState() {
		if (!room) return;

		try {
			const response = await fetch(`/api/map-rooms/${room.token}`);
			if (!response.ok) throw new Error('Failed to refresh room');
			const payload = await response.json();
			applyParsedPlannerState(payload.state as CompactState);
			roomError = null;
		} catch {
			roomError = 'Failed to resync the live room.';
		}
	}

	async function changeRoomMap(targetSlug: string) {
		if (!room || !room.isHost || mapChangeBusy) return;
		if (!targetSlug || targetSlug === mapSlug) return;
		if (typeof window === 'undefined') return;

		mapChangeBusy = true;
		roomError = null;
		roomNotice = 'Switching map…';

		try {
			const response = await fetch(`/api/map-rooms/${room.token}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mapSlug: targetSlug })
			});

			if (!response.ok) {
				const body = await response.json().catch(() => ({ message: 'Failed to change map' }));
				roomError = body.message ?? 'Failed to change map';
				roomNotice = null;
				mapChangeSelection = mapSlug;
				return;
			}

			const payload = await response.json();
			const nextUrl = (payload.roomUrl as string | undefined) ?? `/maps/${targetSlug}/room/${room.token}`;

			if (roomChannel) {
				try {
					await roomChannel.send({
						type: 'broadcast',
						event: 'map-changed',
						payload: { mapSlug: targetSlug, roomUrl: nextUrl }
					});
				} catch {
					/* best-effort broadcast; receivers will still re-sync on next room load */
				}
			}

			window.location.assign(nextUrl);
		} catch {
			roomError = 'Network error while changing map.';
			roomNotice = null;
			mapChangeSelection = mapSlug;
		} finally {
			mapChangeBusy = false;
		}
	}

	function syncParticipantsFromPresence() {
		if (!roomChannel) {
			participants = [];
			return;
		}

		const rawPresence = roomChannel.presenceState<PlannerParticipantPresence>();
		participants = Object.entries(rawPresence)
			.flatMap(([key, values]) =>
				values.map((value) => ({
					key,
					name: value.name,
					tool: value.tool,
					isHost: value.isHost,
					joinedAt: value.joinedAt
				}))
			)
			.sort((left, right) => left.joinedAt.localeCompare(right.joinedAt));
	}

	function buildRoomEnvelope(operation: PlannerOperation): PlannerOperationEnvelope {
		return {
			eventId: createPlannerId('event'),
			actorId,
			actorName,
			clientTs: new Date().toISOString(),
			operation
		};
	}

	async function persistAndBroadcastRoomOperation(envelope: PlannerOperationEnvelope) {
		if (!room) return;

		const response = await fetch(`/api/map-rooms/${room.token}/events`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(envelope)
		});

		if (!response.ok) {
			throw new Error('Failed to persist room operation');
		}

		if (roomChannel && roomConnectionState === 'connected') {
			await roomChannel.send({
				type: 'broadcast',
				event: 'planner-op',
				payload: envelope
			});
		}
	}

	function updateSelectionForOperation(operation: PlannerOperation) {
		if (operation.type === 'delete_shape' && selectedShapeId === operation.shapeId) {
			selectedShapeId = null;
		}
		if (operation.type === 'delete_stamp' && selectedStampId === operation.stampId) {
			selectedStampId = null;
		}
		if (operation.type === 'clear_room') {
			selectedShapeId = null;
			selectedStampId = null;
		}
		if (operation.type === 'add_shape' || operation.type === 'update_shape') {
			selectedShapeId = operation.shape.id;
		}
		if (operation.type === 'add_stamp' || operation.type === 'update_stamp') {
			selectedStampId = operation.stamp.id;
		}
	}

	function applyOperationLocally(operation: PlannerOperation, options: { remember?: boolean } = {}) {
		if (!room && (options.remember ?? true)) {
			rememberState();
		}

		setPlannerState(applyPlannerOperation(getPlannerState(), operation), { clearHistory: false });
		updateSelectionForOperation(operation);
		redrawPlanner();
	}

	function commitPlannerOperation(operation: PlannerOperation, options: { remember?: boolean } = {}) {
		if (room && !actorIdentityReady) return;
		applyOperationLocally(operation, options);

		if (!room) {
			return;
		}

		const envelope = buildRoomEnvelope(operation);
		seenRoomEventIds.add(envelope.eventId);
		roomError = null;
		roomNotice = 'Syncing live room…';

		void persistAndBroadcastRoomOperation(envelope)
			.then(() => {
				roomNotice = null;
			})
			.catch(async () => {
				roomError = 'Live room sync failed. Reconnecting to canonical state…';
				roomNotice = null;
				await refreshRoomState();
			});
	}

	function clampShapeOffset(shape: { originalStart: Point; originalEnd: Point }, dx: number, dy: number) {
		const minX = Math.min(shape.originalStart.x, shape.originalEnd.x);
		const maxX = Math.max(shape.originalStart.x, shape.originalEnd.x);
		const minY = Math.min(shape.originalStart.y, shape.originalEnd.y);
		const maxY = Math.max(shape.originalStart.y, shape.originalEnd.y);
		return {
			dx: Math.max(-minX, Math.min(dx, 1 - maxX)),
			dy: Math.max(-minY, Math.min(dy, 1 - maxY))
		};
	}

	function translateShape(shape: ShapeEntry, dx: number, dy: number): ShapeEntry {
		return {
			...shape,
			start: {
				x: shape.start.x + dx,
				y: shape.start.y + dy
			},
			end: {
				x: shape.end.x + dx,
				y: shape.end.y + dy
			}
		};
	}

	function deleteShape(e: MouseEvent, shapeId: string) {
		e.preventDefault();
		e.stopPropagation();
		commitPlannerOperation({ type: 'delete_shape', shapeId }, { remember: true });
	}

	function drawLineToCanvas(
		ctx: CanvasRenderingContext2D,
		shape: ShapeEntry | ShapeDraft,
		w: number,
		h: number
	) {
		const { x1, y1, x2, y2 } = getShapePixelBounds(shape, w, h);
		const length = Math.hypot(x2 - x1, y2 - y1);
		if (length < 4) return;

		const lineDrawEnd = getLineDrawEnd(shape);
		const lineX2 = lineDrawEnd.x * w;
		const lineY2 = lineDrawEnd.y * h;

		ctx.save();
		ctx.strokeStyle = shape.color;
		ctx.fillStyle = shape.color;
		ctx.lineWidth = shape.width;
		ctx.lineCap = shape.endType === 'arrow' ? 'butt' : 'round';
		ctx.lineJoin = 'round';
		ctx.shadowColor = withAlpha(shape.color, 0.35);
		ctx.shadowBlur = shape.width * 2.4;
		applyLineStyleToCanvas(ctx, shape.lineStyle, shape.width);

		ctx.beginPath();
		ctx.moveTo(x1, y1);
		ctx.lineTo(lineX2, lineY2);
		ctx.stroke();
		ctx.setLineDash([]);

		const arrowHeadSize = Math.max(12, shape.width * 4.6);
		function drawArrowHead(fromX: number, fromY: number, toX: number, toY: number) {
			const angle = Math.atan2(toY - fromY, toX - fromX);
			ctx.beginPath();
			ctx.moveTo(toX, toY);
			ctx.lineTo(
				toX - arrowHeadSize * Math.cos(angle - Math.PI / 7),
				toY - arrowHeadSize * Math.sin(angle - Math.PI / 7)
			);
			ctx.lineTo(
				toX - arrowHeadSize * 0.68 * Math.cos(angle),
				toY - arrowHeadSize * 0.68 * Math.sin(angle)
			);
			ctx.lineTo(
				toX - arrowHeadSize * Math.cos(angle + Math.PI / 7),
				toY - arrowHeadSize * Math.sin(angle + Math.PI / 7)
			);
			ctx.closePath();
			ctx.fill();
		}

		if (shape.endType === 'arrow') {
			drawArrowHead(x1, y1, x2, y2);
		} else if (shape.endType === 'stop') {
			const stopHalf = Math.max(10, shape.width * 3.2);
			const normalX = -(y2 - y1) / length;
			const normalY = (x2 - x1) / length;
			ctx.beginPath();
			ctx.moveTo(x2 + normalX * stopHalf, y2 + normalY * stopHalf);
			ctx.lineTo(x2 - normalX * stopHalf, y2 - normalY * stopHalf);
			ctx.stroke();
		}

		ctx.shadowBlur = 0;
		ctx.restore();
	}

	function drawMeasureToCanvas(
		ctx: CanvasRenderingContext2D,
		shape: ShapeEntry | ShapeDraft,
		w: number,
		h: number
	) {
		const centerX = shape.start.x * w;
		const centerY = shape.start.y * h;
		const targetX = shape.end.x * w;
		const targetY = shape.end.y * h;
		const radius = getMeasureRadius(shape) * Math.min(w, h);

		ctx.save();
		ctx.strokeStyle = shape.color;
		ctx.fillStyle = shape.color;
		ctx.lineWidth = shape.width;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.shadowColor = withAlpha(shape.color, 0.28);
		ctx.shadowBlur = shape.width * 1.8;

		ctx.beginPath();
		ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
		ctx.stroke();

		ctx.beginPath();
		ctx.moveTo(centerX, centerY);
		ctx.lineTo(targetX, targetY);
		ctx.strokeStyle = 'rgba(18, 22, 30, 0.55)';
		ctx.lineWidth = shape.width * 1.6;
		ctx.stroke();
		ctx.strokeStyle = shape.color;
		ctx.lineWidth = Math.max(2, shape.width * 0.72);
		ctx.stroke();

		const label = getMeasureLabel(shape);
		const labelPos = getMeasureLabelPosition(shape);
		const labelX = labelPos.x * w;
		const labelY = labelPos.y * h;
		ctx.font = `700 ${Math.max(14, shape.width * 2.5)}px system-ui, sans-serif`;
		ctx.shadowBlur = 0;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		ctx.strokeStyle = 'rgba(18, 22, 30, 0.78)';
		ctx.lineWidth = Math.max(3, shape.width * 0.42);
		ctx.strokeText(label, labelX, labelY);
		ctx.fillStyle = shape.color;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(label, labelX, labelY);
		ctx.restore();
	}

	function drawCircleToCanvas(
		ctx: CanvasRenderingContext2D,
		shape: ShapeEntry | ShapeDraft,
		w: number,
		h: number
	) {
		const { centerX, centerY, width, height } = getShapePixelBounds(shape, w, h);
		const radiusX = Math.max(width / 2, shape.width * 2.5);
		const radiusY = Math.max(height / 2, shape.width * 2.5);

		ctx.save();
		ctx.strokeStyle = shape.color;
		ctx.fillStyle = withAlpha(shape.color, 0.12);
		ctx.lineWidth = shape.width;
		ctx.shadowColor = withAlpha(shape.color, 0.22);
		ctx.shadowBlur = shape.width * 1.8;

		ctx.beginPath();
		ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
		ctx.fill();

		applyLineStyleToCanvas(ctx, shape.lineStyle, shape.width);
		ctx.beginPath();
		ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
		ctx.stroke();

		ctx.shadowBlur = 0;
		ctx.setLineDash([]);
		ctx.globalAlpha = 0.45;
		ctx.beginPath();
		ctx.ellipse(centerX, centerY, radiusX * 0.68, radiusY * 0.68, 0, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
	}

	function drawRectangleToCanvas(
		ctx: CanvasRenderingContext2D,
		shape: ShapeEntry | ShapeDraft,
		w: number,
		h: number
	) {
		const bounds = getShapePixelBounds(shape, w, h);
		const width = Math.max(bounds.width, shape.width * 3);
		const height = Math.max(bounds.height, shape.width * 3);
		const left = bounds.centerX - width / 2;
		const top = bounds.centerY - height / 2;
		const corner = Math.min(Math.max(14, Math.min(width, height) * 0.24), 38);

		ctx.save();
		ctx.fillStyle = withAlpha(shape.color, 0.1);
		ctx.strokeStyle = shape.color;
		ctx.lineWidth = shape.width;
		ctx.shadowColor = withAlpha(shape.color, 0.22);
		ctx.shadowBlur = shape.width * 1.8;

		ctx.fillRect(left, top, width, height);

		applyLineStyleToCanvas(ctx, shape.lineStyle, shape.width);
		ctx.strokeRect(left, top, width, height);
		ctx.setLineDash([]);

		ctx.shadowBlur = 0;
		ctx.beginPath();
		ctx.moveTo(left, top + corner);
		ctx.lineTo(left, top);
		ctx.lineTo(left + corner, top);

		ctx.moveTo(left + width - corner, top);
		ctx.lineTo(left + width, top);
		ctx.lineTo(left + width, top + corner);

		ctx.moveTo(left + width, top + height - corner);
		ctx.lineTo(left + width, top + height);
		ctx.lineTo(left + width - corner, top + height);

		ctx.moveTo(left + corner, top + height);
		ctx.lineTo(left, top + height);
		ctx.lineTo(left, top + height - corner);
		ctx.stroke();
		ctx.restore();
	}

	function drawPingToCanvas(
		ctx: CanvasRenderingContext2D,
		shape: ShapeEntry | ShapeDraft,
		w: number,
		h: number
	) {
		const { x1, y1, x2, y2 } = getShapePixelBounds(shape, w, h);
		const radius = Math.max(18, Math.hypot(x2 - x1, y2 - y1));

		ctx.save();
		ctx.fillStyle = withAlpha(shape.color, 0.16);
		ctx.beginPath();
		ctx.arc(x1, y1, radius * 1.35, 0, Math.PI * 2);
		ctx.fill();

		ctx.strokeStyle = shape.color;
		ctx.lineWidth = Math.max(2, shape.width * 0.9);
		ctx.shadowColor = withAlpha(shape.color, 0.28);
		ctx.shadowBlur = shape.width * 2.1;

		applyLineStyleToCanvas(ctx, shape.lineStyle, shape.width);
		ctx.beginPath();
		ctx.arc(x1, y1, radius, 0, Math.PI * 2);
		ctx.stroke();

		ctx.setLineDash([]);
		ctx.globalAlpha = 0.5;
		ctx.beginPath();
		ctx.arc(x1, y1, radius * 0.58, 0, Math.PI * 2);
		ctx.stroke();

		ctx.shadowBlur = 0;
		ctx.globalAlpha = 1;
		ctx.fillStyle = shape.color;
		ctx.beginPath();
		ctx.arc(x1, y1, Math.max(5, shape.width), 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}

	function drawShapeToCanvas(
		ctx: CanvasRenderingContext2D,
		shape: ShapeEntry | ShapeDraft,
		w: number,
		h: number
	) {
		if (shape.kind === 'line') {
			drawLineToCanvas(ctx, shape, w, h);
			return;
		}
		if (shape.kind === 'measure') {
			drawMeasureToCanvas(ctx, shape, w, h);
			return;
		}
		if (shape.kind === 'circle') {
			drawCircleToCanvas(ctx, shape, w, h);
			return;
		}
		if (shape.kind === 'rectangle') {
			drawRectangleToCanvas(ctx, shape, w, h);
			return;
		}
		drawPingToCanvas(ctx, shape, w, h);
	}

	function drawTankToCanvas(
		ctx: CanvasRenderingContext2D,
		cx: number,
		cy: number,
		size: number,
		col: string,
		vehicleId?: string
	) {
		ctx.save();
		ctx.translate(cx, cy);
		const radius = size * 0.75;

		ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
		ctx.shadowBlur = radius * 0.3;
		ctx.shadowOffsetY = radius * 0.1;

		ctx.beginPath();
		ctx.arc(0, 0, radius, 0, Math.PI * 2);
		ctx.fillStyle = '#1a1d23';
		ctx.fill();
		ctx.shadowColor = 'transparent';

		const vehicleImage = vehicleId ? getVehicleImg(vehicleId) : null;
		if (vehicleImage && vehicleImage.complete && vehicleImage.naturalWidth > 0) {
			ctx.save();
			ctx.beginPath();
			ctx.arc(0, 0, radius - 2, 0, Math.PI * 2);
			ctx.clip();
			const imageSize = radius * 2.6;
			ctx.drawImage(vehicleImage, -imageSize / 2, -imageSize * 0.45, imageSize, imageSize);
			ctx.restore();
		}

		ctx.beginPath();
		ctx.arc(0, 0, radius, 0, Math.PI * 2);
		ctx.strokeStyle = col;
		ctx.lineWidth = Math.max(2, radius * 0.15);
		ctx.stroke();

		ctx.beginPath();
		ctx.arc(0, 0, radius - Math.max(2, radius * 0.15) / 2 - 0.5, 0, Math.PI * 2);
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
		ctx.lineWidth = 1;
		ctx.stroke();

		ctx.restore();
	}

	function drawZoneToCanvas(
		ctx: CanvasRenderingContext2D,
		cx: number,
		cy: number,
		size: number,
		col: string
	) {
		ctx.save();
		ctx.translate(cx, cy);
		const scale = size / 24;
		const radius = 18 * scale;

		ctx.globalAlpha = 0.2;
		ctx.fillStyle = col;
		ctx.beginPath();
		ctx.arc(0, 0, radius, 0, Math.PI * 2);
		ctx.fill();
		ctx.globalAlpha = 1;

		ctx.strokeStyle = col;
		ctx.lineWidth = 2.5 * scale;
		ctx.setLineDash([6 * scale, 4 * scale]);
		ctx.beginPath();
		ctx.arc(0, 0, radius, 0, Math.PI * 2);
		ctx.stroke();
		ctx.setLineDash([]);

		ctx.globalAlpha = 0.5;
		ctx.lineWidth = 1 * scale;
		ctx.beginPath();
		ctx.arc(0, 0, 12 * scale, 0, Math.PI * 2);
		ctx.stroke();
		ctx.globalAlpha = 1;

		ctx.strokeStyle = col;
		ctx.lineWidth = 2 * scale;
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.moveTo(-4 * scale, -10 * scale);
		ctx.lineTo(-4 * scale, 10 * scale);
		ctx.stroke();

		ctx.fillStyle = col;
		ctx.beginPath();
		ctx.moveTo(-4 * scale, -10 * scale);
		ctx.lineTo(8 * scale, -6 * scale);
		ctx.lineTo(-4 * scale, -2 * scale);
		ctx.closePath();
		ctx.fill();

		ctx.beginPath();
		ctx.moveTo(-8 * scale, 10 * scale);
		ctx.lineTo(0, 10 * scale);
		ctx.stroke();

		ctx.restore();
	}

	function drawStampToCanvas(
		ctx: CanvasRenderingContext2D,
		stamp: StampEntry,
		w: number,
		h: number,
		scale: number
	) {
		const cx = stamp.pos.x * w;
		const cy = stamp.pos.y * h;
		const size = (stamp.stamp === 'tank' ? 32 : 24) * scale;
		const col = stamp.side === 'friendly' ? FRIENDLY_COLOR : ENEMY_COLOR;

		if (stamp.stamp === 'tank') {
			drawTankToCanvas(ctx, cx, cy, size, col, stamp.vehicleId);
			return;
		}
		drawZoneToCanvas(ctx, cx, cy, size, col);
	}

	function buildExportOverlaySvg(displayWidth: number) {
		const elements: string[] = [];

		for (const stamp of stamps) {
			const tankInfo =
				stamp.stamp === 'tank' && stamp.vehicleId
					? tanks.find((tank) => tank.id === stamp.vehicleId)
					: null;
			if (!stamp.showVision || !tankInfo) continue;

			const cx = toSvgCoord(stamp.pos.x);
			const cy = toSvgCoord(stamp.pos.y);
			const ringColor = stamp.side === 'friendly' ? FRIENDLY_COLOR : ENEMY_COLOR;
			const radius = formatSvgNumber(getVisionRadiusSvg(tankInfo.vision));
			const innerRadius = formatSvgNumber(Math.max(getVisionRadiusSvg(tankInfo.vision) * 0.5, 12));
			const labelPos = getVisionLabelPosition(stamp);
			const labelX = toSvgCoord(labelPos.x);
			const labelY = toSvgCoord(labelPos.y);
			const labelFontSize = formatSvgNumber(toExportSvgLength(10, displayWidth));
			const outerStroke = formatSvgNumber(toExportSvgLength(5, displayWidth));
			const midStroke = formatSvgNumber(toExportSvgLength(2.5, displayWidth));
			const innerStroke = formatSvgNumber(toExportSvgLength(1.25, displayWidth));
			const ringDash = `${formatSvgNumber(toExportSvgLength(16, displayWidth))} ${formatSvgNumber(toExportSvgLength(12, displayWidth))}`;

			elements.push(
				`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="rgba(8,12,18,0.42)" stroke-width="${outerStroke}" stroke-dasharray="${ringDash}"/>`,
				`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${withAlpha(ringColor, 0.035)}" stroke="${ringColor}" stroke-opacity="0.94" stroke-width="${midStroke}" stroke-dasharray="${ringDash}"/>`,
				`<circle cx="${cx}" cy="${cy}" r="${innerRadius}" fill="none" stroke="rgba(8,12,18,0.35)" stroke-width="${midStroke}"/>`,
				`<circle cx="${cx}" cy="${cy}" r="${innerRadius}" fill="none" stroke="${ringColor}" stroke-opacity="0.45" stroke-width="${innerStroke}"/>`,
				`<text x="${labelX}" y="${labelY}" fill="#ffffff" font-family="system-ui, sans-serif" font-size="${labelFontSize}" font-weight="700" text-anchor="middle" dominant-baseline="middle" paint-order="stroke" stroke="rgba(8,12,18,0.82)" stroke-width="${formatSvgNumber(toExportSvgLength(3, displayWidth))}">${escapeSvgText(getVisionLabel(tankInfo.vision))}</text>`
			);
		}

		for (const shape of shapes) {
			const strokeWidth = formatSvgNumber(toExportSvgLength(getShapeStrokeWidth(shape), displayWidth));
			const dashArray = getExportSvgDashArray(shape.lineStyle, getShapeStrokeWidth(shape), displayWidth);
			const dashAttr = dashArray ? ` stroke-dasharray="${dashArray}"` : '';

			if (shape.kind === 'line') {
				elements.push(
					`<line x1="${toSvgCoord(shape.start.x)}" y1="${toSvgCoord(shape.start.y)}" x2="${toSvgCoord(shape.end.x)}" y2="${toSvgCoord(shape.end.y)}" stroke="${shape.color}" stroke-width="${strokeWidth}"${dashAttr} stroke-linecap="round" stroke-linejoin="round"/>`
				);

				if (shape.endType === 'arrow') {
					const arrowPoints = getArrowHeadPoints(shape.start, shape.end, shape.width);
					if (arrowPoints) {
						elements.push(`<polygon points="${arrowPoints}" fill="${shape.color}"/>`);
					}
				} else if (shape.endType === 'stop') {
					const stopCap = getStopCapSegment(shape.start, shape.end, shape.width);
					if (stopCap) {
						elements.push(
							`<line x1="${toSvgCoord(stopCap.x1)}" y1="${toSvgCoord(stopCap.y1)}" x2="${toSvgCoord(stopCap.x2)}" y2="${toSvgCoord(stopCap.y2)}" stroke="${shape.color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`
						);
					}
				}

				continue;
			}

			if (shape.kind === 'measure') {
				const radius = getMeasureRadius(shape);
				const labelPos = getMeasureLabelPosition(shape);
				const labelFontSize = formatSvgNumber(
					toExportSvgLength(Math.max(14, getShapeStrokeWidth(shape) * 2.5), displayWidth)
				);
				elements.push(
					`<circle cx="${toSvgCoord(shape.start.x)}" cy="${toSvgCoord(shape.start.y)}" r="${toSvgCoord(radius)}" fill="none" stroke="${shape.color}" stroke-width="${strokeWidth}"/>`,
					`<line x1="${toSvgCoord(shape.start.x)}" y1="${toSvgCoord(shape.start.y)}" x2="${toSvgCoord(shape.end.x)}" y2="${toSvgCoord(shape.end.y)}" stroke="${shape.color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`,
					`<text x="${toSvgCoord(labelPos.x)}" y="${toSvgCoord(labelPos.y)}" fill="${shape.color}" font-family="system-ui, sans-serif" font-size="${labelFontSize}" font-weight="700" text-anchor="middle" dominant-baseline="middle" paint-order="stroke" stroke="rgba(18,22,30,0.78)" stroke-width="${formatSvgNumber(toExportSvgLength(Math.max(3, getShapeStrokeWidth(shape) * 0.42), displayWidth))}">${escapeSvgText(getMeasureLabel(shape))}</text>`
				);
				continue;
			}

			if (shape.kind === 'circle') {
				const bounds = getShapeBounds(shape);
				elements.push(
					`<ellipse cx="${toSvgCoord(bounds.centerX)}" cy="${toSvgCoord(bounds.centerY)}" rx="${toSvgCoord(Math.max(bounds.width / 2, 0.015))}" ry="${toSvgCoord(Math.max(bounds.height / 2, 0.015))}" fill="${withAlpha(shape.color, 0.12)}" stroke="${shape.color}" stroke-width="${strokeWidth}"${dashAttr}/>`
				);
				continue;
			}

			if (shape.kind === 'rectangle') {
				const bounds = getShapeBounds(shape);
				elements.push(
					`<rect x="${toSvgCoord(bounds.left)}" y="${toSvgCoord(bounds.top)}" width="${toSvgCoord(Math.max(bounds.width, 0.02))}" height="${toSvgCoord(Math.max(bounds.height, 0.02))}" fill="${withAlpha(shape.color, 0.1)}" stroke="${shape.color}" stroke-width="${strokeWidth}"${dashAttr}/>`
				);
				continue;
			}

			const radius = Math.max(distanceBetween(shape.start, shape.end), 0.026);
			elements.push(
				`<circle cx="${toSvgCoord(shape.start.x)}" cy="${toSvgCoord(shape.start.y)}" r="${toSvgCoord(radius * 1.35)}" fill="${withAlpha(shape.color, 0.12)}" stroke="${shape.color}" stroke-width="${strokeWidth}"${dashAttr}/>`,
				`<circle cx="${toSvgCoord(shape.start.x)}" cy="${toSvgCoord(shape.start.y)}" r="${toSvgCoord(radius * 0.44)}" fill="none" stroke="${shape.color}" stroke-opacity="0.55" stroke-width="${formatSvgNumber(toExportSvgLength(Math.max(1, getShapeStrokeWidth(shape) * 0.6), displayWidth))}"/>`
			);
		}

		for (const stamp of stamps) {
			if (stamp.stamp !== 'zone') continue;
			const col = stamp.side === 'friendly' ? FRIENDLY_COLOR : ENEMY_COLOR;
			const cx = toSvgCoord(stamp.pos.x);
			const cy = toSvgCoord(stamp.pos.y);
			const outerRadius = formatSvgNumber(toExportSvgLength(18, displayWidth));
			const innerRadius = formatSvgNumber(toExportSvgLength(12, displayWidth));
			const outerStroke = formatSvgNumber(toExportSvgLength(2.5, displayWidth));
			const innerStroke = formatSvgNumber(toExportSvgLength(1, displayWidth));
			const stemStroke = formatSvgNumber(toExportSvgLength(2, displayWidth));
			const arrowX = formatSvgNumber(toExportSvgLength(4, displayWidth));
			const arrowY = formatSvgNumber(toExportSvgLength(10, displayWidth));
			const arrowTipX = formatSvgNumber(toExportSvgLength(8, displayWidth));

			elements.push(
				`<g transform="translate(${cx} ${cy})">`,
				`<circle cx="0" cy="0" r="${outerRadius}" fill="${col}" opacity="0.2"/>`,
				`<circle cx="0" cy="0" r="${outerRadius}" fill="none" stroke="${col}" stroke-width="${outerStroke}" stroke-dasharray="${formatSvgNumber(toExportSvgLength(6, displayWidth))} ${formatSvgNumber(toExportSvgLength(4, displayWidth))}"/>`,
				`<circle cx="0" cy="0" r="${innerRadius}" fill="none" stroke="${col}" stroke-width="${innerStroke}" opacity="0.5"/>`,
				`<line x1="-${arrowX}" y1="-${arrowY}" x2="-${arrowX}" y2="${arrowY}" stroke="${col}" stroke-width="${stemStroke}" stroke-linecap="round"/>`,
				`<polygon points="-${arrowX},-${arrowY} ${arrowTipX},-${formatSvgNumber(toExportSvgLength(6, displayWidth))} -${arrowX},-${formatSvgNumber(toExportSvgLength(2, displayWidth))}" fill="${col}"/>`,
				`<line x1="-${formatSvgNumber(toExportSvgLength(8, displayWidth))}" y1="${arrowY}" x2="0" y2="${arrowY}" stroke="${col}" stroke-width="${stemStroke}" stroke-linecap="round"/>`,
				`</g>`
			);
		}

		if (elements.length === 0) return null;

		return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">${elements.join('')}</svg>`;
	}

	function loadImage(src: string): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const image = new Image();
			image.onload = () => resolve(image);
			image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
			image.src = src;
		});
	}

	async function drawExportOverlay(
		ctx: CanvasRenderingContext2D,
		w: number,
		h: number,
		displayWidth: number
	) {
		const svg = buildExportOverlaySvg(displayWidth);
		if (!svg) return false;

		const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
		const url = URL.createObjectURL(blob);

		try {
			const image = await loadImage(url);
			ctx.drawImage(image, 0, 0, w, h);
			return true;
		} catch {
			return false;
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	function buildPreviewStroke(points: Point[]): Stroke {
		return {
			id: createPlannerId('stroke'),
			points,
			color,
			width: getConfiguredStrokeWidth(lineWidth) * getDevicePixelRatio(),
			tool: toolMode === 'eraser' ? 'eraser' : 'pen',
			lineStyle: toolMode === 'eraser' ? 'solid' : lineStyle,
			endType: toolMode === 'eraser' ? 'none' : lineEnd
		};
	}

	function redrawAll(preview?: { stroke?: Stroke; shape?: ShapeDraft }) {
		if (!canvasEl) return;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;
		const w = canvasEl.width;
		const h = canvasEl.height;
		ctx.clearRect(0, 0, w, h);

		for (const stroke of strokes) {
			drawStroke(ctx, stroke, w, h);
		}
		if (preview?.stroke) {
			drawStroke(ctx, preview.stroke, w, h);
		}
	}

	function syncCanvasSize() {
		if (!canvasEl || !containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		canvasEl.width = Math.max(1, Math.round(rect.width * dpr));
		canvasEl.height = Math.max(1, Math.round(rect.height * dpr));
		redrawPlanner();
		captureBaseHeight();
	}

	function cycleVehicle(stamp: StampEntry) {
		if (stamp.stamp !== 'tank' || tanks.length === 0) return;
		const index = tanks.findIndex((tank) => tank.id === stamp.vehicleId);
		const next = tanks[(index + 1 + tanks.length) % tanks.length];
		commitPlannerOperation(
			{
				type: 'update_stamp',
				stamp: {
					...stamp,
					vehicleId: next.id
				}
			},
			{ remember: true }
		);
	}

	function toggleStampVision(stampId: string) {
		const stamp = stamps.find((entry) => entry.id === stampId);
		if (!stamp || stamp.stamp !== 'tank') return;
		commitPlannerOperation(
			{
				type: 'update_stamp',
				stamp: {
					...stamp,
					showVision: !stamp.showVision
				}
			},
			{ remember: true }
		);
	}

	function getVisionRadiusSvg(visionMeters: number) {
		return (visionMeters / mapMeters) * 1000;
	}

	function getVisionLabel(visionMeters: number) {
		return `${Math.round(visionMeters)}m`;
	}

	function getVisionLabelPosition(stamp: StampEntry) {
		return clampPoint({
			x: stamp.pos.x + 0.055,
			y: stamp.pos.y - 0.048
		});
	}

	function drawVisionRingToCanvas(
		ctx: CanvasRenderingContext2D,
		stamp: StampEntry,
		tankInfo: TankInfo,
		w: number,
		h: number
	) {
		const cx = stamp.pos.x * w;
		const cy = stamp.pos.y * h;
		const radius = (tankInfo.vision / mapMeters) * Math.min(w, h);
		const ringColor = stamp.side === 'friendly' ? FRIENDLY_COLOR : ENEMY_COLOR;
		const labelPos = getVisionLabelPosition(stamp);
		const labelX = labelPos.x * w;
		const labelY = labelPos.y * h;
		const label = getVisionLabel(tankInfo.vision);

		ctx.save();
		ctx.setLineDash([16, 12]);
		ctx.strokeStyle = 'rgba(8, 12, 18, 0.42)';
		ctx.lineWidth = Math.max(4.5, w / 280);
		ctx.beginPath();
		ctx.arc(cx, cy, radius, 0, Math.PI * 2);
		ctx.stroke();

		ctx.strokeStyle = withAlpha(ringColor, 0.94);
		ctx.lineWidth = Math.max(2.4, w / 520);
		ctx.beginPath();
		ctx.arc(cx, cy, radius, 0, Math.PI * 2);
		ctx.stroke();

		ctx.fillStyle = withAlpha(ringColor, 0.035);
		ctx.beginPath();
		ctx.arc(cx, cy, radius, 0, Math.PI * 2);
		ctx.fill();

		ctx.setLineDash([]);
		ctx.strokeStyle = 'rgba(8, 12, 18, 0.35)';
		ctx.lineWidth = Math.max(2, w / 600);
		ctx.beginPath();
		ctx.arc(cx, cy, Math.max(radius * 0.5, 12), 0, Math.PI * 2);
		ctx.stroke();

		ctx.strokeStyle = withAlpha(ringColor, 0.45);
		ctx.lineWidth = Math.max(1, w / 1000);
		ctx.beginPath();
		ctx.arc(cx, cy, Math.max(radius * 0.5, 12), 0, Math.PI * 2);
		ctx.stroke();

		ctx.font = `700 ${Math.max(12, w / 85)}px system-ui, sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.strokeStyle = 'rgba(8, 12, 18, 0.82)';
		ctx.lineWidth = Math.max(3, w / 300);
		ctx.strokeText(label, labelX, labelY);
		ctx.fillStyle = '#ffffff';
		ctx.fillText(label, labelX, labelY);
		ctx.restore();
	}

	function finalizeShape(draft: ShapeDraft): ShapeEntry | null {
		const delta = distanceBetween(draft.start, draft.end);
		if (draft.kind === 'line' && delta < 0.01) return null;
		if (draft.kind === 'measure' && delta < 0.01) return null;
		if ((draft.kind === 'circle' || draft.kind === 'rectangle') && delta < 0.01) return null;

		if (draft.kind === 'ping' && delta < 0.002) {
			draft = {
				...draft,
				end: clampPoint({
					x: draft.start.x + 0.035,
					y: draft.start.y
				})
			};
		}

		return {
			id: createPlannerId('shape'),
			...draft
		};
	}

	function onCanvasPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		if (room && !actorIdentityReady) return;
		const pos = getCanvasPointerPos(e);
		selectedShapeId = null;

		if (toolMode === 'stamp') {
			const entry: StampEntry = {
				id: createPlannerId('stamp'),
				pos,
				stamp: activeStamp,
				side: activeSide
			};
			if (activeStamp === 'tank' && tanks.length > 0) {
				entry.vehicleId = tanks[0].id;
			}
			commitPlannerOperation({ type: 'add_stamp', stamp: entry }, { remember: true });
			return;
		}

		canvasEl.setPointerCapture(e.pointerId);

		if (toolMode === 'eraser') {
			eraserGestureDirty = false;
			currentStroke = [pos];
			const operation = eraseAtPoint(pos);
			if (operation) {
				if (!room && !eraserGestureDirty) {
					rememberState();
					eraserGestureDirty = true;
				}
				commitPlannerOperation(operation, { remember: false });
			}
			return;
		}

		if (toolMode === 'shape') {
			currentShape = {
				kind: activeShape,
				start: pos,
				end: pos,
				color: activeShape === 'measure' ? '#ffffff' : color,
				width: getConfiguredStrokeWidth(lineWidth) * getDevicePixelRatio(),
				lineStyle: activeShape === 'measure' ? 'solid' : lineStyle,
				endType: activeShape === 'measure' ? 'none' : lineEnd
			};
			redrawAll();
			return;
		}

		currentStroke = [pos];
		redrawAll({ stroke: buildPreviewStroke(currentStroke) });
	}

	function onCanvasPointerMove(e: PointerEvent) {
		if (currentShape) {
			currentShape = {
				...currentShape,
				end: getCanvasPointerPos(e)
			};
			return;
		}

		if (!currentStroke) return;
		const point = getCanvasPointerPos(e);
		if (toolMode === 'eraser') {
			currentStroke = [point];
			const operation = eraseAtPoint(point);
			if (operation) {
				if (!room && !eraserGestureDirty) {
					rememberState();
					eraserGestureDirty = true;
				}
				commitPlannerOperation(operation, { remember: false });
			}
			return;
		}

		currentStroke = appendBrushPoint(currentStroke, point);
		redrawAll({ stroke: buildPreviewStroke(currentStroke) });
	}

	function onCanvasPointerUp(e?: PointerEvent) {
		if (currentShape) {
			if (currentShape.kind === 'measure') {
				currentShape = null;
				redrawAll();
				return;
			}
			const finalized = finalizeShape(currentShape);
			currentShape = null;
			if (finalized) {
				commitPlannerOperation({ type: 'add_shape', shape: finalized }, { remember: true });
			}
			redrawPlanner();
			return;
		}

		if (toolMode === 'eraser') {
			currentStroke = null;
			eraserGestureDirty = false;
			return;
		}

		if (currentStroke && e) {
			currentStroke = appendBrushPoint(currentStroke, getCanvasPointerPos(e), true);
		}

		if (!currentStroke || currentStroke.length < 2) {
			currentStroke = null;
			redrawPlanner();
			return;
		}

		commitPlannerOperation(
			{
				type: 'add_stroke',
				stroke: {
					...buildPreviewStroke(currentStroke),
					id: createPlannerId('stroke'),
					tool: 'pen'
				}
			},
			{ remember: true }
		);
		currentStroke = null;
		redrawPlanner();
	}

	function onStampPointerDown(e: PointerEvent, stamp: StampEntry) {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		if (toolMode === 'eraser') {
			eraserGestureDirty = false;
			const operation = eraseAtPoint(getPointerPos(e));
			if (operation) {
				if (!room && !eraserGestureDirty) {
					rememberState();
					eraserGestureDirty = true;
				}
				commitPlannerOperation(operation, { remember: false });
			}
			return;
		}
		stampDragMoved = false;
		const rect = containerEl.getBoundingClientRect();
		draggingStamp = {
			id: stamp.id,
			offsetX: (e.clientX - rect.left) / rect.width - stamp.pos.x,
			offsetY: (e.clientY - rect.top) / rect.height - stamp.pos.y,
			originalPos: { ...stamp.pos }
		};
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onStampPointerMove(e: PointerEvent) {
		if (!draggingStamp) return;
		const drag = draggingStamp;
		e.stopPropagation();
		const pos = getPointerPos(e);
		const nextPos = clampPoint({
			x: pos.x - drag.offsetX,
			y: pos.y - drag.offsetY
		});
		if (
			!stampDragMoved &&
			(Math.abs(nextPos.x - drag.originalPos.x) > 0.001 ||
				Math.abs(nextPos.y - drag.originalPos.y) > 0.001)
		) {
			if (!room) rememberState();
			stampDragMoved = true;
		}
		if (!stampDragMoved) return;
		stamps = stamps.map((stamp) =>
			stamp.id === drag.id
				? {
						...stamp,
						pos: nextPos
					}
				: stamp
		);
		redrawPlanner();
	}

	function onStampPointerUp(e: PointerEvent) {
		if (!draggingStamp) return;
		e.stopPropagation();
		const stampId = draggingStamp.id;
		draggingStamp = null;
		if (stampDragMoved) {
			const stamp = stamps.find((entry) => entry.id === stampId);
			if (stamp) {
				commitPlannerOperation(
					{
						type: 'update_stamp',
						stamp
					},
					{ remember: false }
				);
			}
		} else {
			const stamp = stamps.find((entry) => entry.id === stampId);
			if (stamp) {
				if (selectedStampId === stampId && stamp.stamp === 'tank') {
					cycleVehicle(stamp);
				} else {
					selectedStampId = stampId;
				}
			}
		}
		stampDragMoved = false;
	}

	function deleteStamp(e: MouseEvent, stampId: string) {
		e.preventDefault();
		e.stopPropagation();
		commitPlannerOperation({ type: 'delete_stamp', stampId }, { remember: true });
	}

	function onShapePointerDown(e: PointerEvent, shape: ShapeEntry) {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		if (toolMode === 'eraser') {
			eraserGestureDirty = false;
			const operation = eraseAtPoint(getPointerPos(e));
			if (operation) {
				if (!room && !eraserGestureDirty) {
					rememberState();
					eraserGestureDirty = true;
				}
				commitPlannerOperation(operation, { remember: false });
			}
			return;
		}
		selectedShapeId = shape.id;
		shapeDragMoved = false;
		draggingShape = {
			id: shape.id,
			anchor: getPointerPos(e),
			originalStart: { ...shape.start },
			originalEnd: { ...shape.end }
		};
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
	}

	function onShapePointerMove(e: PointerEvent) {
		if (!draggingShape) return;
		const drag = draggingShape;
		e.stopPropagation();
		const pos = getPointerPos(e);
		const rawDx = pos.x - drag.anchor.x;
		const rawDy = pos.y - drag.anchor.y;
		const { dx, dy } = clampShapeOffset(drag, rawDx, rawDy);
		if (!shapeDragMoved && (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001)) {
			if (!room) rememberState();
			shapeDragMoved = true;
		}
		if (!shapeDragMoved) return;
		shapes = shapes.map((shape) =>
			shape.id === drag.id
				? translateShape(
						{
							...shape,
							start: { ...drag.originalStart },
							end: { ...drag.originalEnd }
						},
						dx,
						dy
					)
				: shape
		);
		redrawPlanner();
	}

	function onShapePointerUp(e: PointerEvent) {
		if (!draggingShape) return;
		const drag = draggingShape;
		e.stopPropagation();
		if (shapeDragMoved) {
			const shape = shapes.find((entry) => entry.id === drag.id);
			if (shape) {
				commitPlannerOperation(
					{
						type: 'update_shape',
						shape
					},
					{ remember: false }
				);
			}
		}
		draggingShape = null;
		shapeDragMoved = false;
	}

	function undo() {
		if (room) return;
		if (undoStack.length === 0) return;
		const previous = undoStack[undoStack.length - 1];
		redoStack = [...redoStack, snapshotCurrent()].slice(-HISTORY_LIMIT);
		undoStack = undoStack.slice(0, -1);
		restoreSnapshot(previous);
	}

	function redo() {
		if (room) return;
		if (redoStack.length === 0) return;
		const next = redoStack[redoStack.length - 1];
		undoStack = [...undoStack, snapshotCurrent()].slice(-HISTORY_LIMIT);
		redoStack = redoStack.slice(0, -1);
		restoreSnapshot(next);
	}

	function clearAll() {
		if (!hasContent) return;
		currentStroke = null;
		currentShape = null;
		commitPlannerOperation({ type: 'clear_room' }, { remember: true });
	}

	function onKeydown(e: KeyboardEvent) {
		const mod = e.ctrlKey || e.metaKey;
		if (!room && mod && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			undo();
		} else if (!room && mod && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
			e.preventDefault();
			redo();
		} else if (!mod && (e.key === 'Delete' || e.key === 'Backspace') && selectedShapeId !== null) {
			e.preventDefault();
			commitPlannerOperation({ type: 'delete_shape', shapeId: selectedShapeId }, { remember: true });
		}
	}

	function selectStamp(stamp: StampType, side: 'friendly' | 'enemy') {
		toolMode = 'stamp';
		activeStamp = stamp;
		activeSide = side;
		activeDrawer = 'markers';
	}

	function selectShape(kind: ShapeKind) {
		toolMode = 'shape';
		activeShape = kind;
		activeDrawer = kind === 'measure' ? 'actions' : 'style';
	}

	function setPrimaryTool(next: 'pen' | 'eraser') {
		toolMode = next;
		activeDrawer = 'style';
	}

	function toggleDrawer(section: Exclude<DrawerSection, null>) {
		activeDrawer = activeDrawer === section ? null : section;
	}

	function isActiveShape(kind: ShapeKind) {
		return toolMode === 'shape' && activeShape === kind;
	}

	function isActiveStamp(stamp: StampType, side: 'friendly' | 'enemy') {
		return toolMode === 'stamp' && activeStamp === stamp && activeSide === side;
	}

	function getActiveToolLabel() {
		if (toolMode === 'pen') return 'Brush';
		if (toolMode === 'eraser') return 'Eraser';
		if (toolMode === 'stamp') return 'Marker';
		return shapeButtons.find((button) => button.kind === activeShape)?.label ?? activeShape;
	}

	function getCursor() {
		if (room && !actorIdentityReady) return 'not-allowed';
		if (draggingShape) return 'grabbing';
		if (draggingStamp) return 'grabbing';
		if (toolMode === 'stamp') return 'copy';
		return 'crosshair';
	}

	async function exportPng() {
		if (!imgEl) return;

		const w = imgEl.naturalWidth;
		const h = imgEl.naturalHeight;
		const gutterSize = Math.round(w * 0.025);
		const totalW = w + gutterSize;
		const totalH = h + gutterSize;
		const offscreen = document.createElement('canvas');
		offscreen.width = totalW;
		offscreen.height = totalH;
		const ctx = offscreen.getContext('2d');
		if (!ctx) return;

		ctx.drawImage(imgEl, 0, 0, w, h);

		ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
		ctx.lineWidth = Math.max(1, w / 1000);
		for (let i = 1; i < 10; i += 1) {
			const x = (i / 10) * w;
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, h);
			ctx.stroke();

			const y = (i / 10) * h;
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(w, y);
			ctx.stroke();
		}

		ctx.fillStyle = '#1a1d23';
		ctx.fillRect(0, h, totalW, gutterSize);
		ctx.fillRect(w, 0, gutterSize, totalH);

		const labelSize = Math.round(gutterSize * 0.55);
		ctx.fillStyle = '#8a8f98';
		ctx.font = `bold ${labelSize}px sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		for (let i = 0; i < 10; i += 1) {
			const cx = (i + 0.5) * (w / 10);
			ctx.fillText(gridCols[i], cx, h + gutterSize / 2);
		}

		for (let i = 0; i < 10; i += 1) {
			const cy = (i + 0.5) * (h / 10);
			ctx.fillText(gridRows[i], w + gutterSize / 2, cy);
		}

		const displayWidth = containerEl.getBoundingClientRect().width;
		const exportScale = w / displayWidth;
		const dpr = window.devicePixelRatio || 1;

		for (const stroke of strokes) {
			drawStroke(
				ctx,
				{
					...stroke,
					width: (stroke.width / dpr) * exportScale
				},
				w,
				h
			);
		}

		const overlayDrawn = await drawExportOverlay(ctx, w, h, displayWidth);
		if (!overlayDrawn) {
			for (const shape of shapes) {
				drawShapeToCanvas(
					ctx,
					{
						...shape,
						width: (shape.width / dpr) * exportScale
					},
					w,
					h
				);
			}

			for (const stamp of stamps) {
				const tankInfo =
					stamp.stamp === 'tank' && stamp.vehicleId
						? tanks.find((tank) => tank.id === stamp.vehicleId)
						: null;
				if (stamp.showVision && tankInfo) {
					drawVisionRingToCanvas(ctx, stamp, tankInfo, w, h);
				}
			}
		}

		const stampScale = exportScale * 1.2;
		for (const stamp of stamps) {
			if (overlayDrawn && stamp.stamp === 'zone') continue;
			drawStampToCanvas(ctx, stamp, w, h, stampScale);
		}

		offscreen.toBlob((blob) => {
			if (!blob) return;
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			const slug = mapName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
			const timestamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');
			anchor.download = `${slug}-${timestamp}.png`;
			anchor.click();
			URL.revokeObjectURL(url);
		}, 'image/png');
	}

	function toBase64Url(bytes: Uint8Array): string {
		let binary = '';
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	}

	function fromBase64Url(value: string): Uint8Array {
		const padded = value.replace(/-/g, '+').replace(/_/g, '/');
		const binary = atob(padded);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}

	async function compressState(): Promise<string> {
		const json = JSON.stringify(buildCompactState(getPlannerState()));
		const blob = new Blob([json]);
		const compressionStream = new CompressionStream('deflate');
		const compressed = blob.stream().pipeThrough(compressionStream);
		const reader = compressed.getReader();
		const chunks: Uint8Array[] = [];

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
		}

		const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
		const result = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			result.set(chunk, offset);
			offset += chunk.length;
		}

		return toBase64Url(result);
	}

	async function decompressState(encoded: string): Promise<CompactState | null> {
		try {
			const bytes = fromBase64Url(encoded);
			const blob = new Blob([Uint8Array.from(bytes)]);
			const decompressionStream = new DecompressionStream('deflate');
			const decompressed = blob.stream().pipeThrough(decompressionStream);
			const reader = decompressed.getReader();
			const chunks: Uint8Array[] = [];

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
			}

			const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
			const result = new Uint8Array(total);
			let offset = 0;
			for (const chunk of chunks) {
				result.set(chunk, offset);
				offset += chunk.length;
			}

			const json = new TextDecoder().decode(result);
			return JSON.parse(json) as CompactState;
		} catch {
			return null;
		}
	}

	async function shareUrl() {
		if (!hasContent) return;
		const encoded = await compressState();
		const url = getAbsoluteUrl(
			`${window.location.pathname}#plan=${encoded}`,
			window.location.origin
		);
		await navigator.clipboard.writeText(url);
		shareStatus = 'copied';
		setTimeout(() => {
			shareStatus = 'idle';
		}, 2000);
	}

	onMount(() => {
		if (room) {
			hydrateActorIdentity();
			applyParsedPlannerState(room.initialState);
			plannerHydrated = true;
			return;
		}

		const storageKey = getPlannerStorageKey();
		lastPlannerStorageKey = storageKey;
		const hash = window.location.hash;
		if (hash.startsWith('#plan=')) {
			const encoded = hash.slice(6);
			decompressState(encoded).then((state) => {
				if (state) {
					applyParsedPlannerState(state);
				} else {
					restorePlannerDraft(storageKey);
				}
				plannerHydrated = true;
			});
			return;
		}

		restorePlannerDraft(storageKey);
		plannerHydrated = true;
	});

	$effect(() => {
		if (room) return;
		if (typeof window === 'undefined' || !plannerHydrated) return;
		const storageKey = getPlannerStorageKey();

		if (storageKey !== lastPlannerStorageKey) {
			lastPlannerStorageKey = storageKey;
			restorePlannerDraft(storageKey);
			return;
		}

		strokes;
		stamps;
		shapes;
		persistPlannerDraft(storageKey);
	});

	$effect(() => {
		if (!room || !plannerHydrated || !actorIdentityReady) return;
		if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_ANON_KEY) {
			roomConnectionState = 'error';
			roomError = 'Supabase realtime is not configured for live rooms.';
			return;
		}

		let active = true;
		const supabase = createClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
			auth: {
				autoRefreshToken: false,
				persistSession: false
			},
			global: { fetch }
		});
		roomConnectionState = 'connecting';
		roomNotice = 'Connecting to live room…';
		roomError = null;

		const channel = supabase.channel(`map-room:${room.token}`, {
			config: {
				broadcast: { self: false },
				presence: { key: roomPresenceKey }
			}
		});
		roomChannel = channel;

		channel
			.on('broadcast', { event: 'planner-op' }, ({ payload }) => {
				const envelope = payload as PlannerOperationEnvelope;
				if (!envelope?.eventId || seenRoomEventIds.has(envelope.eventId)) return;
				seenRoomEventIds.add(envelope.eventId);
				applyOperationLocally(envelope.operation, { remember: false });
				roomNotice = null;
			})
			.on('broadcast', { event: 'map-changed' }, ({ payload }) => {
				const next = payload as { mapSlug?: string; roomUrl?: string } | undefined;
				if (!next?.mapSlug || next.mapSlug === mapSlug) return;
				if (typeof window === 'undefined') return;
				roomNotice = 'The host changed the map. Loading…';
				const target = next.roomUrl ?? (room ? `/maps/${next.mapSlug}/room/${room.token}` : null);
				if (target) window.location.assign(target);
			})
			.on('presence', { event: 'sync' }, () => {
				syncParticipantsFromPresence();
			})
			.on('presence', { event: 'join' }, () => {
				syncParticipantsFromPresence();
			})
			.on('presence', { event: 'leave' }, () => {
				syncParticipantsFromPresence();
			})
			.subscribe((status, err) => {
				if (!active) return;
				if (status === 'SUBSCRIBED') {
					roomConnectionState = 'connected';
					roomError = null;
					roomNotice = null;
					void channel
						.track({
							name: actorName,
							tool: getActiveToolLabel(),
							isHost: room.isHost,
							joinedAt: roomPresenceJoinedAt
						})
						.then(() => refreshRoomState());
				} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
					roomConnectionState = 'connecting';
					roomNotice = 'Realtime reconnecting…';
					if (err?.message) {
						roomError = err.message;
					}
				} else if (status === 'CLOSED') {
					roomConnectionState = 'connecting';
					roomNotice = 'Realtime reconnecting…';
				}
			});

		return () => {
			active = false;
			participants = [];
			roomConnectionState = 'disconnected';
			roomChannel = null;
			void channel.untrack();
			void supabase.removeChannel(channel);
			supabase.realtime.disconnect();
		};
	});

	$effect(() => {
		if (!containerEl) return;
		const observer = new ResizeObserver(() => syncCanvasSize());
		observer.observe(containerEl);
		return () => observer.disconnect();
	});

	const selectedStamp = $derived(
		selectedStampId !== null ? stamps.find((stamp) => stamp.id === selectedStampId) ?? null : null
	);
	const selectedStampTank = $derived(
		selectedStamp?.vehicleId ? tanks.find((tank) => tank.id === selectedStamp.vehicleId) ?? null : null
	);
	const selectedShape = $derived(
		selectedShapeId !== null ? shapes.find((shape) => shape.id === selectedShapeId) ?? null : null
	);
	const isRoomMode = $derived(Boolean(room));
	const canStartLiveRoom = $derived(Boolean(currentUser) && !room);
	const hasContent = $derived(strokes.length > 0 || stamps.length > 0 || shapes.length > 0);
	const lineControlsEnabled = $derived(
		toolMode === 'pen' ||
			(toolMode === 'shape' &&
				(activeShape === 'line' ||
					activeShape === 'circle' ||
					activeShape === 'rectangle' ||
					activeShape === 'ping'))
	);
	const endControlsEnabled = $derived(
		toolMode === 'pen' || (toolMode === 'shape' && activeShape === 'line')
	);
</script>

<svelte:window onkeydown={onKeydown} />

<div>
	<div
		bind:this={viewportEl}
		class="overflow-auto"
		style={viewportBaseH > 0 && zoom > 1 ? `max-height: ${viewportBaseH}px;` : ''}
		onwheel={onZoomWheel}
	>
		<div style={zoom > 1 ? `width: ${zoom * 100}%;` : ''}>
			<div class="flex">
				<div class="flex min-w-0 flex-1 flex-col">
					<div
						class="relative w-full select-none"
						bind:this={containerEl}
						role="application"
						aria-label="Tactical map planner"
					>
						<img
							bind:this={imgEl}
							src={minimapSrc}
							alt="{mapName} minimap"
							class="block h-auto w-full"
							crossorigin="anonymous"
							onload={syncCanvasSize}
							draggable="false"
						/>

						<div class="pointer-events-none absolute inset-0" style="z-index: 1;">
							<svg
								class="absolute inset-0 h-full w-full"
								xmlns="http://www.w3.org/2000/svg"
								preserveAspectRatio="none"
							>
								{#each { length: 9 } as _, i}
									<line
										x1="{(i + 1) * 10}%"
										y1="0"
										x2="{(i + 1) * 10}%"
										y2="100%"
										stroke="rgba(255,255,255,0.12)"
										stroke-width="1"
									/>
									<line
										x1="0"
										y1="{(i + 1) * 10}%"
										x2="100%"
										y2="{(i + 1) * 10}%"
										stroke="rgba(255,255,255,0.12)"
										stroke-width="1"
									/>
								{/each}
							</svg>
						</div>

						<canvas
							bind:this={canvasEl}
							class="absolute inset-0 h-full w-full"
							style="touch-action: none; cursor: {getCursor()}; z-index: 2;"
							onpointerdown={onCanvasPointerDown}
							onpointermove={onCanvasPointerMove}
							onpointerup={onCanvasPointerUp}
							onpointercancel={onCanvasPointerUp}
						></canvas>

						<svg
							class="pointer-events-none absolute inset-0 h-full w-full"
							style="z-index: 3;"
							viewBox="0 0 1000 1000"
							preserveAspectRatio="none"
						>
							{#each stamps as stamp (stamp.id)}
								{@const tankInfo = stamp.vehicleId ? tanks.find((tank) => tank.id === stamp.vehicleId) : null}
								{@const ringColor = stamp.side === 'friendly' ? FRIENDLY_COLOR : ENEMY_COLOR}
								{#if stamp.stamp === 'tank' && stamp.showVision && tankInfo}
									{@const visionRadius = getVisionRadiusSvg(tankInfo.vision)}
									<circle
										cx={toSvgCoord(stamp.pos.x)}
										cy={toSvgCoord(stamp.pos.y)}
										r={visionRadius}
										fill="none"
										stroke="rgba(8,12,18,0.42)"
										stroke-width="5"
										stroke-dasharray="16 12"
										vector-effect="non-scaling-stroke"
									/>
									<circle
										cx={toSvgCoord(stamp.pos.x)}
										cy={toSvgCoord(stamp.pos.y)}
										r={visionRadius}
										fill={withAlpha(ringColor, 0.035)}
										stroke={ringColor}
										stroke-opacity="0.94"
										stroke-width="2.5"
										stroke-dasharray="16 12"
										vector-effect="non-scaling-stroke"
									/>
									<circle
										cx={toSvgCoord(stamp.pos.x)}
										cy={toSvgCoord(stamp.pos.y)}
										r={Math.max(visionRadius * 0.5, 12)}
										fill="none"
										stroke="rgba(8,12,18,0.35)"
										stroke-width="2.5"
										vector-effect="non-scaling-stroke"
									/>
									<circle
										cx={toSvgCoord(stamp.pos.x)}
										cy={toSvgCoord(stamp.pos.y)}
										r={Math.max(visionRadius * 0.5, 12)}
										fill="none"
										stroke={ringColor}
										stroke-opacity="0.45"
										stroke-width="1.25"
										vector-effect="non-scaling-stroke"
									/>
								{/if}
							{/each}

							{#each shapes as shape (shape.id)}
								<g
									class={toolMode === 'eraser' ? 'pointer-events-none' : 'pointer-events-auto'}
									role="button"
									tabindex="-1"
									onpointerdown={(e) => onShapePointerDown(e, shape)}
									onpointermove={onShapePointerMove}
									onpointerup={onShapePointerUp}
									onpointercancel={onShapePointerUp}
									oncontextmenu={(e) => deleteShape(e, shape.id)}
								>
									{#if shape.kind === 'line'}
										{@const lineEnd = getLineDrawEnd(shape)}
										{@const visibleCap = shape.endType === 'arrow' ? 'butt' : 'round'}
										{#if selectedShapeId === shape.id}
											<line
												x1={toSvgCoord(shape.start.x)}
												y1={toSvgCoord(shape.start.y)}
												x2={toSvgCoord(shape.end.x)}
												y2={toSvgCoord(shape.end.y)}
												stroke="rgba(255,255,255,0.18)"
												stroke-width={getShapeStrokeWidth(shape) + 8}
												vector-effect="non-scaling-stroke"
												stroke-linecap="round"
											/>
										{/if}
										<line
											x1={toSvgCoord(shape.start.x)}
											y1={toSvgCoord(shape.start.y)}
											x2={toSvgCoord(shape.end.x)}
											y2={toSvgCoord(shape.end.y)}
											stroke="transparent"
											stroke-width={getShapeHitWidth(shape)}
											vector-effect="non-scaling-stroke"
											stroke-linecap="round"
										/>
										<line
											x1={toSvgCoord(shape.start.x)}
											y1={toSvgCoord(shape.start.y)}
											x2={toSvgCoord(lineEnd.x)}
											y2={toSvgCoord(lineEnd.y)}
											stroke={shape.color}
											stroke-width={getShapeStrokeWidth(shape)}
											stroke-dasharray={getSvgDashArray(shape.lineStyle, getShapeStrokeWidth(shape))}
											vector-effect="non-scaling-stroke"
											stroke-linecap={visibleCap}
											stroke-linejoin="round"
										/>
										{#if shape.endType === 'arrow'}
											<polygon points={getArrowHeadPoints(shape.start, shape.end, shape.width)} fill={shape.color} />
										{:else if shape.endType === 'stop'}
											{@const stopCap = getStopCapSegment(shape.start, shape.end, shape.width)}
											{#if stopCap}
												<line
													x1={toSvgCoord(stopCap.x1)}
													y1={toSvgCoord(stopCap.y1)}
													x2={toSvgCoord(stopCap.x2)}
													y2={toSvgCoord(stopCap.y2)}
													stroke={shape.color}
													stroke-width={getShapeStrokeWidth(shape)}
													vector-effect="non-scaling-stroke"
													stroke-linecap="round"
												/>
											{/if}
										{/if}
									{:else if shape.kind === 'measure'}
										{@const radius = getMeasureRadius(shape)}
										{#if selectedShapeId === shape.id}
											<circle
												cx={toSvgCoord(shape.start.x)}
												cy={toSvgCoord(shape.start.y)}
												r={toSvgCoord(radius)}
												fill="none"
												stroke="rgba(255,255,255,0.18)"
												stroke-width={getShapeStrokeWidth(shape) + 8}
												vector-effect="non-scaling-stroke"
											/>
										{/if}
										<circle
											cx={toSvgCoord(shape.start.x)}
											cy={toSvgCoord(shape.start.y)}
											r={toSvgCoord(radius)}
											fill="transparent"
											stroke="transparent"
											stroke-width={getShapeHitWidth(shape)}
											vector-effect="non-scaling-stroke"
										/>
										<circle
											cx={toSvgCoord(shape.start.x)}
											cy={toSvgCoord(shape.start.y)}
											r={toSvgCoord(radius)}
											fill="none"
											stroke={shape.color}
											stroke-width={getShapeStrokeWidth(shape)}
											vector-effect="non-scaling-stroke"
										/>
										<line
											x1={toSvgCoord(shape.start.x)}
											y1={toSvgCoord(shape.start.y)}
											x2={toSvgCoord(shape.end.x)}
											y2={toSvgCoord(shape.end.y)}
											stroke={shape.color}
											stroke-width={getShapeStrokeWidth(shape)}
											vector-effect="non-scaling-stroke"
											stroke-linecap="round"
										/>
									{:else if shape.kind === 'circle'}
										{@const bounds = getShapeBounds(shape)}
										{#if selectedShapeId === shape.id}
											<ellipse
												cx={toSvgCoord(bounds.centerX)}
												cy={toSvgCoord(bounds.centerY)}
												rx={toSvgCoord(Math.max(bounds.width / 2, 0.015))}
												ry={toSvgCoord(Math.max(bounds.height / 2, 0.015))}
												fill="none"
												stroke="rgba(255,255,255,0.18)"
												stroke-width={getShapeStrokeWidth(shape) + 8}
												vector-effect="non-scaling-stroke"
											/>
										{/if}
										<ellipse
											cx={toSvgCoord(bounds.centerX)}
											cy={toSvgCoord(bounds.centerY)}
											rx={toSvgCoord(Math.max(bounds.width / 2, 0.015))}
											ry={toSvgCoord(Math.max(bounds.height / 2, 0.015))}
											fill="transparent"
											stroke="transparent"
											stroke-width={getShapeHitWidth(shape)}
											vector-effect="non-scaling-stroke"
										/>
										<ellipse
											cx={toSvgCoord(bounds.centerX)}
											cy={toSvgCoord(bounds.centerY)}
											rx={toSvgCoord(Math.max(bounds.width / 2, 0.015))}
											ry={toSvgCoord(Math.max(bounds.height / 2, 0.015))}
											fill={withAlpha(shape.color, 0.12)}
											stroke={shape.color}
											stroke-width={getShapeStrokeWidth(shape)}
											stroke-dasharray={getSvgDashArray(shape.lineStyle, getShapeStrokeWidth(shape))}
											vector-effect="non-scaling-stroke"
										/>
									{:else if shape.kind === 'rectangle'}
										{@const bounds = getShapeBounds(shape)}
										{#if selectedShapeId === shape.id}
											<rect
												x={toSvgCoord(bounds.left)}
												y={toSvgCoord(bounds.top)}
												width={toSvgCoord(Math.max(bounds.width, 0.02))}
												height={toSvgCoord(Math.max(bounds.height, 0.02))}
												fill="none"
												stroke="rgba(255,255,255,0.18)"
												stroke-width={getShapeStrokeWidth(shape) + 8}
												vector-effect="non-scaling-stroke"
											/>
										{/if}
										<rect
											x={toSvgCoord(bounds.left)}
											y={toSvgCoord(bounds.top)}
											width={toSvgCoord(Math.max(bounds.width, 0.02))}
											height={toSvgCoord(Math.max(bounds.height, 0.02))}
											fill="transparent"
											stroke="transparent"
											stroke-width={getShapeHitWidth(shape)}
											vector-effect="non-scaling-stroke"
										/>
										<rect
											x={toSvgCoord(bounds.left)}
											y={toSvgCoord(bounds.top)}
											width={toSvgCoord(Math.max(bounds.width, 0.02))}
											height={toSvgCoord(Math.max(bounds.height, 0.02))}
											fill={withAlpha(shape.color, 0.1)}
											stroke={shape.color}
											stroke-width={getShapeStrokeWidth(shape)}
											stroke-dasharray={getSvgDashArray(shape.lineStyle, getShapeStrokeWidth(shape))}
											vector-effect="non-scaling-stroke"
										/>
									{:else}
										{@const radius = Math.max(distanceBetween(shape.start, shape.end), 0.026)}
										{#if selectedShapeId === shape.id}
											<circle
												cx={toSvgCoord(shape.start.x)}
												cy={toSvgCoord(shape.start.y)}
												r={toSvgCoord(radius * 1.35)}
												fill="none"
												stroke="rgba(255,255,255,0.18)"
												stroke-width={getShapeStrokeWidth(shape) + 8}
												vector-effect="non-scaling-stroke"
											/>
										{/if}
										<circle
											cx={toSvgCoord(shape.start.x)}
											cy={toSvgCoord(shape.start.y)}
											r={toSvgCoord(radius * 1.35)}
											fill="transparent"
											stroke="transparent"
											stroke-width={getShapeHitWidth(shape)}
											vector-effect="non-scaling-stroke"
										/>
										<circle
											cx={toSvgCoord(shape.start.x)}
											cy={toSvgCoord(shape.start.y)}
											r={toSvgCoord(radius * 1.35)}
											fill={withAlpha(shape.color, 0.12)}
											stroke={shape.color}
											stroke-width={getShapeStrokeWidth(shape)}
											stroke-dasharray={getSvgDashArray(shape.lineStyle, getShapeStrokeWidth(shape))}
											vector-effect="non-scaling-stroke"
										/>
										<circle
											cx={toSvgCoord(shape.start.x)}
											cy={toSvgCoord(shape.start.y)}
											r={toSvgCoord(radius * 0.44)}
											fill="none"
											stroke={shape.color}
											stroke-opacity="0.55"
											stroke-width={Math.max(1, getShapeStrokeWidth(shape) * 0.6)}
											vector-effect="non-scaling-stroke"
										/>
									{/if}
								</g>
							{/each}

							{#if currentShape}
								<g opacity="0.92">
									{#if currentShape.kind === 'line'}
										{@const previewLineEnd = getLineDrawEnd(currentShape)}
										{@const previewCap = currentShape.endType === 'arrow' ? 'butt' : 'round'}
										<line
											x1={toSvgCoord(currentShape.start.x)}
											y1={toSvgCoord(currentShape.start.y)}
											x2={toSvgCoord(previewLineEnd.x)}
											y2={toSvgCoord(previewLineEnd.y)}
											stroke={currentShape.color}
											stroke-width={getShapeStrokeWidth(currentShape)}
											stroke-dasharray={getSvgDashArray(currentShape.lineStyle, getShapeStrokeWidth(currentShape))}
											vector-effect="non-scaling-stroke"
											stroke-linecap={previewCap}
										/>
										{#if currentShape.endType === 'arrow'}
											<polygon points={getArrowHeadPoints(currentShape.start, currentShape.end, currentShape.width)} fill={currentShape.color} />
										{:else if currentShape.endType === 'stop'}
											{@const stopCap = getStopCapSegment(currentShape.start, currentShape.end, currentShape.width)}
											{#if stopCap}
												<line
													x1={toSvgCoord(stopCap.x1)}
													y1={toSvgCoord(stopCap.y1)}
													x2={toSvgCoord(stopCap.x2)}
													y2={toSvgCoord(stopCap.y2)}
													stroke={currentShape.color}
													stroke-width={getShapeStrokeWidth(currentShape)}
													vector-effect="non-scaling-stroke"
													stroke-linecap="round"
												/>
											{/if}
										{/if}
									{:else if currentShape.kind === 'measure'}
										{@const radius = getMeasureRadius(currentShape)}
										<circle
											cx={toSvgCoord(currentShape.start.x)}
											cy={toSvgCoord(currentShape.start.y)}
											r={toSvgCoord(radius)}
											fill="none"
											stroke={currentShape.color}
											stroke-width={getShapeStrokeWidth(currentShape)}
											vector-effect="non-scaling-stroke"
										/>
										<line
											x1={toSvgCoord(currentShape.start.x)}
											y1={toSvgCoord(currentShape.start.y)}
											x2={toSvgCoord(currentShape.end.x)}
											y2={toSvgCoord(currentShape.end.y)}
											stroke={currentShape.color}
											stroke-width={getShapeStrokeWidth(currentShape)}
											vector-effect="non-scaling-stroke"
											stroke-linecap="round"
										/>
									{:else if currentShape.kind === 'circle'}
										{@const bounds = getShapeBounds(currentShape)}
										<ellipse
											cx={toSvgCoord(bounds.centerX)}
											cy={toSvgCoord(bounds.centerY)}
											rx={toSvgCoord(Math.max(bounds.width / 2, 0.015))}
											ry={toSvgCoord(Math.max(bounds.height / 2, 0.015))}
											fill={withAlpha(currentShape.color, 0.12)}
											stroke={currentShape.color}
											stroke-width={getShapeStrokeWidth(currentShape)}
											stroke-dasharray={getSvgDashArray(currentShape.lineStyle, getShapeStrokeWidth(currentShape))}
											vector-effect="non-scaling-stroke"
										/>
									{:else if currentShape.kind === 'rectangle'}
										{@const bounds = getShapeBounds(currentShape)}
										<rect
											x={toSvgCoord(bounds.left)}
											y={toSvgCoord(bounds.top)}
											width={toSvgCoord(Math.max(bounds.width, 0.02))}
											height={toSvgCoord(Math.max(bounds.height, 0.02))}
											fill={withAlpha(currentShape.color, 0.1)}
											stroke={currentShape.color}
											stroke-width={getShapeStrokeWidth(currentShape)}
											stroke-dasharray={getSvgDashArray(currentShape.lineStyle, getShapeStrokeWidth(currentShape))}
											vector-effect="non-scaling-stroke"
										/>
									{:else}
										{@const radius = Math.max(distanceBetween(currentShape.start, currentShape.end), 0.026)}
										<circle
											cx={toSvgCoord(currentShape.start.x)}
											cy={toSvgCoord(currentShape.start.y)}
											r={toSvgCoord(radius * 1.35)}
											fill={withAlpha(currentShape.color, 0.12)}
											stroke={currentShape.color}
											stroke-width={getShapeStrokeWidth(currentShape)}
											stroke-dasharray={getSvgDashArray(currentShape.lineStyle, getShapeStrokeWidth(currentShape))}
											vector-effect="non-scaling-stroke"
										/>
										<circle
											cx={toSvgCoord(currentShape.start.x)}
											cy={toSvgCoord(currentShape.start.y)}
											r={toSvgCoord(radius * 0.44)}
											fill="none"
											stroke={currentShape.color}
											stroke-opacity="0.55"
											stroke-width={Math.max(1, getShapeStrokeWidth(currentShape) * 0.6)}
											vector-effect="non-scaling-stroke"
										/>
									{/if}
								</g>
							{/if}
						</svg>

						{#each shapes as shape (shape.id)}
							{#if shape.kind === 'measure'}
								{@const labelPos = getMeasureLabelPosition(shape)}
								<div
									class="pointer-events-none absolute px-1 text-sm font-bold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]"
									style="left: {labelPos.x * 100}%; top: {labelPos.y * 100}%; transform: translate(-50%, -50%); z-index: 4;"
								>
									{getMeasureLabel(shape)}
								</div>
							{/if}
						{/each}

						{#if currentShape?.kind === 'measure'}
							{@const labelPos = getMeasureLabelPosition(currentShape)}
							<div
								class="pointer-events-none absolute px-1 text-sm font-bold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]"
								style="left: {labelPos.x * 100}%; top: {labelPos.y * 100}%; transform: translate(-50%, -50%); z-index: 4;"
							>
								{getMeasureLabel(currentShape)}
							</div>
						{/if}

						{#each stamps as stamp (stamp.id)}
							{@const col = stamp.side === 'friendly' ? FRIENDLY_COLOR : ENEMY_COLOR}
							{@const tankInfo = stamp.vehicleId ? tanks.find((tank) => tank.id === stamp.vehicleId) : null}
							<div
								class="stamp-overlay absolute {toolMode === 'eraser' ? 'pointer-events-none' : ''}"
								style="
									left: {stamp.pos.x * 100}%;
									top: {stamp.pos.y * 100}%;
									transform: translate(-50%, -50%);
									cursor: {draggingStamp?.id === stamp.id ? 'grabbing' : 'grab'};
									touch-action: none;
									z-index: {draggingStamp?.id === stamp.id ? 20 : 10};
								"
								role="button"
								tabindex="-1"
								onpointerdown={(e) => onStampPointerDown(e, stamp)}
								onpointermove={onStampPointerMove}
								onpointerup={onStampPointerUp}
								onpointercancel={onStampPointerUp}
								oncontextmenu={(e) => deleteStamp(e, stamp.id)}
							>
								{#if stamp.stamp === 'tank'}
									<div
										class="pointer-events-none relative"
										style="width: 44px; height: 44px;"
										title={tankInfo?.name ?? 'Tank'}
									>
										<div
											class="absolute inset-0 overflow-hidden rounded-full"
											style="
												border: 3px solid {col};
												box-shadow: 0 2px 6px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.1);
												background: #1a1d23;
											"
										>
											{#if stamp.vehicleId}
												<img
													src="/images/vehicles/{stamp.vehicleId}.png"
													alt={tankInfo?.name ?? ''}
													class="absolute h-[130%] w-[130%] object-cover object-top"
													style="top: -5%; left: -15%;"
													draggable="false"
												/>
											{/if}
										</div>
										{#if stamp.showVision && tankInfo}
											<div
												class="absolute left-[calc(100%+0.4rem)] top-1/2 rounded-sm bg-[rgba(8,12,18,0.78)] px-1.5 py-0.5 text-[10px] font-bold tracking-[0.08em] text-white shadow-[0_4px_10px_rgba(0,0,0,0.35)]"
												style="transform: translateY(-50%);"
											>
												{getVisionLabel(tankInfo.vision)}
											</div>
										{/if}
									</div>
								{:else}
									<svg
										width="38"
										height="38"
										viewBox="-22 -22 44 44"
										fill="none"
										xmlns="http://www.w3.org/2000/svg"
										class="pointer-events-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]"
									>
										<circle cx="0" cy="0" r="18" fill={col} opacity="0.2" />
										<circle
											cx="0"
											cy="0"
											r="18"
											fill="none"
											stroke={col}
											stroke-width="2.5"
											stroke-dasharray="6 4"
										/>
										<circle
											cx="0"
											cy="0"
											r="12"
											fill="none"
											stroke={col}
											stroke-width="1"
											opacity="0.5"
										/>
										<line
											x1="-4"
											y1="-10"
											x2="-4"
											y2="10"
											stroke={col}
											stroke-width="2"
											stroke-linecap="round"
										/>
										<polygon points="-4,-10 8,-6 -4,-2" fill={col} />
										<line
											x1="-8"
											y1="10"
											x2="0"
											y2="10"
											stroke={col}
											stroke-width="2"
											stroke-linecap="round"
										/>
									</svg>
								{/if}
							</div>
						{/each}
					</div>

					<div class="flex h-5 bg-[var(--hud-surface)]">
						{#each gridCols as label}
							<div class="flex flex-1 items-center justify-center">
								<span
									class="font-[var(--font-display)] text-[10px] font-bold tracking-wider text-[var(--hud-muted)]"
								>
									{label}
								</span>
							</div>
						{/each}
					</div>
				</div>

				<div class="flex w-5 flex-col bg-[var(--hud-surface)]">
					{#each gridRows as label}
						<div class="flex flex-1 items-center justify-center">
							<span
								class="font-[var(--font-display)] text-[10px] font-bold tracking-wider text-[var(--hud-muted)]"
							>
								{label}
							</span>
						</div>
					{/each}
					<div class="h-5"></div>
				</div>
			</div>
		</div>
	</div>

	<div
		class="mt-0 space-y-2 rounded-b-sm bg-[var(--hud-panel-mid)] px-3 py-3 shadow-[inset_0_2px_0_0_rgba(102,218,190,0.08)]"
	>
		{#if isRoomMode}
			<div class="hud-panel-muted rounded-sm px-3 py-3 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.18)]">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="space-y-1">
						<p class="hud-eyebrow tracking-[0.22em]">Live Room</p>
						<p class="font-[var(--font-display)] text-sm font-semibold uppercase tracking-[0.08em] text-[var(--hud-text)]">
							{room?.title}
						</p>
						<p class="hud-numeric text-[10px] text-[var(--hud-muted)]">
							{roomConnectionState === 'connected'
								? `${participants.length || 1} connected`
								: roomConnectionState === 'connecting'
									? 'Connecting…'
									: roomConnectionState === 'error'
										? 'Connection error'
										: 'Offline'}
						</p>
					</div>

					<div class="flex flex-wrap items-center gap-2">
						<span class="rounded-sm px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] {roomConnectionState === 'connected'
							? 'bg-[var(--hud-teal)]/15 text-[var(--hud-teal)]'
							: roomConnectionState === 'connecting'
								? 'bg-[#ffd166]/12 text-[#ffd166]'
								: 'bg-[#ef4444]/12 text-[#ef8c8c]'}">
							{roomConnectionState === 'connected'
								? 'Live'
								: roomConnectionState === 'connecting'
									? 'Connecting'
									: roomConnectionState === 'error'
										? 'Retrying'
										: 'Offline'}
						</span>
						{#each participants as participant}
							<span class="rounded-sm bg-[var(--hud-panel)]/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--hud-muted)]">
								{participant.name}{participant.isHost ? ' · host' : ''}
							</span>
						{/each}
					</div>
				</div>

				{#if !actorIdentityReady}
					<form
						class="mt-3 flex flex-wrap items-center gap-2"
						onsubmit={(event) => {
							event.preventDefault();
							saveGuestIdentity();
						}}
					>
						<input
							type="text"
							bind:value={guestNameInput}
							maxlength="32"
							placeholder="Pick a callsign"
							class="min-w-[14rem] flex-1 rounded-sm bg-[var(--hud-panel)]/80 px-3 py-2 text-sm text-[var(--hud-text)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.3)] outline-none placeholder:text-[var(--hud-dim)] focus-visible:ring-2 focus-visible:ring-[var(--hud-teal)]/35"
						/>
						<button class="hud-cta-outline px-4 py-2 text-xs" type="submit" disabled={!guestNameInput.trim()}>
							Join Room
						</button>
					</form>
				{/if}

				{#if room?.isHost && availableMaps.length > 1}
					<div class="mt-3 flex flex-wrap items-center gap-2">
						<label
							for="map-switcher"
							class="hud-eyebrow text-[10px] tracking-[0.22em] text-[var(--hud-muted)]"
						>
							Map
						</label>
						<select
							id="map-switcher"
							class="min-w-[10rem] rounded-sm bg-[var(--hud-panel)]/80 px-2 py-1.5 text-xs text-[var(--hud-text)] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.3)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--hud-teal)]/35"
							disabled={mapChangeBusy}
							value={mapChangeSelection || mapSlug}
							onchange={(event) => {
								const next = (event.currentTarget as HTMLSelectElement).value;
								mapChangeSelection = next;
								if (next !== mapSlug) {
									const confirmed =
										typeof window === 'undefined' ||
										window.confirm(
											'Switching maps will clear the current drawings for everyone in this room. Continue?'
										);
									if (!confirmed) {
										mapChangeSelection = mapSlug;
										return;
									}
									void changeRoomMap(next);
								}
							}}
						>
							{#each availableMaps as option (option.slug)}
								<option value={option.slug}>{option.name}</option>
							{/each}
						</select>
						{#if mapChangeBusy}
							<span class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-muted)]">
								Switching…
							</span>
						{/if}
					</div>
				{/if}

				{#if roomError}
					<p class="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#ef8c8c]">{roomError}</p>
				{:else if roomNotice}
					<p class="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--hud-teal)]">{roomNotice}</p>
				{/if}
			</div>
		{:else if roomError}
			<div class="hud-panel-muted rounded-sm px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#ef8c8c] shadow-[inset_0_0_0_1px_rgba(69,73,50,0.18)]">
				{roomError}
			</div>
		{/if}

		<div class="flex flex-col gap-2">
			<div class="flex flex-wrap items-center gap-2">
				<div class={toolbarGroup}>
					<button
						class="{tbtnTool} {toolMode === 'pen' ? tActive : tIdle}"
						onclick={() => setPrimaryTool('pen')}
						title="Freehand brush"
					>
						<svg
							class={toolGlyph}
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M10.5 2.5 13.5 5.5 7 12l-3.5 1 1-3.5z" />
							<path d="M3.5 13c1.2-.1 2-.8 2-1.7 0-.5-.2-.9-.6-1.2" />
						</svg>
						<span>Brush</span>
					</button>
					<button
						class="{tbtnTool} {toolMode === 'eraser' ? tActive : tIdle}"
						onclick={() => setPrimaryTool('eraser')}
						title="Erase whole lines, shapes, and markers"
					>
						<svg
							class={toolGlyph}
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="m6 3 7 7-2.5 2.5h-5L2.5 9.5Z" />
							<path d="M8 5 11 8" />
							<path d="M9.5 12.5H14" />
						</svg>
						<span>Eraser</span>
					</button>
				</div>

				<div class={toolbarGroup}>
					{#each shapeButtons as button}
						<button
							class="{tbtnTool} {isActiveShape(button.kind) ? tActive : tIdle}"
							onclick={() => selectShape(button.kind)}
							title={button.title}
						>
							{#if button.kind === 'line'}
								<svg
									class={toolGlyph}
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<circle cx="3" cy="13" r="1" fill="currentColor" stroke="none" />
									<circle cx="13" cy="3" r="1" fill="currentColor" stroke="none" />
									<path d="M4.5 11.5 11.5 4.5" />
								</svg>
							{:else if button.kind === 'measure'}
								<svg
									class={toolGlyph}
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d="M3.5 12.5 12.5 3.5" />
									<path d="M5.5 10.5 6.5 11.5" />
									<path d="M7.5 8.5 8.5 9.5" />
									<path d="M9.5 6.5 10.5 7.5" />
								</svg>
							{:else if button.kind === 'circle'}
								<svg
									class={toolGlyph}
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<circle cx="8" cy="8" r="4.5" />
								</svg>
							{:else if button.kind === 'rectangle'}
								<svg
									class={toolGlyph}
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<rect x="3.25" y="4" width="9.5" height="8" rx="1.4" />
								</svg>
							{:else}
								<svg
									class={toolGlyph}
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
									<circle cx="8" cy="8" r="4.5" />
									<path d="M8 2.5v1.5M8 12v1.5M2.5 8H4M12 8h1.5" />
								</svg>
							{/if}
							{button.label}
						</button>
					{/each}
				</div>

				<div class={toolbarGroup}>
					<button
						class="{tbtnTool} {activeDrawer === 'style' ? tActive : tIdle}"
						onclick={() => toggleDrawer('style')}
						title="Open style drawer"
					>
						<svg
							class={toolGlyph}
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M3 4h10" />
							<path d="M3 8h10" />
							<path d="M3 12h10" />
							<circle cx="6" cy="4" r="1.3" fill="currentColor" stroke="none" />
							<circle cx="10" cy="8" r="1.3" fill="currentColor" stroke="none" />
							<circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none" />
						</svg>
						<span>Style</span>
					</button>
					<button
						class="{tbtnTool} {activeDrawer === 'markers' ? tActive : tIdle}"
						onclick={() => toggleDrawer('markers')}
						title="Open marker drawer"
					>
						<svg
							class={toolGlyph}
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M4.5 13.5v-11" />
							<path d="M5 3h6l-1.6 2L11 7H5" />
						</svg>
						<span>Markers</span>
					</button>
					<button
						class="{tbtnTool} {activeDrawer === 'actions' ? tActive : tIdle}"
						onclick={() => toggleDrawer('actions')}
						title="Open actions drawer"
					>
						<svg
							class={toolGlyph}
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M8.5 3H13v4.5" />
							<path d="M13 3 7.5 8.5" />
							<path d="M7 5H3.5v7h7V8.5" />
						</svg>
						<span>Actions</span>
					</button>
				</div>

				<div class="{toolbarGroup} min-w-[14rem] lg:ml-auto">
					<div class="flex flex-col leading-none">
						<span class="hud-eyebrow text-[10px] tracking-[0.22em]">
							{getActiveToolLabel()} Active
						</span>
						<span class="hud-numeric text-[11px] text-[var(--hud-muted)]">
							{activeDrawer === 'style'
								? `Style · ${lineStyle} · ${lineEnd} · ${lineWidth}`
								: activeDrawer === 'markers'
									? 'Marker Drawer Open'
									: activeDrawer === 'actions'
										? 'Action Drawer Open'
										: 'Drawer Collapsed'}
						</span>
					</div>
				</div>
			</div>

			{#if activeDrawer}
				<div class="hud-panel-muted rounded-sm px-3 py-3 shadow-[inset_0_0_0_1px_rgba(69,73,50,0.18)]">
					{#if activeDrawer === 'style'}
						<div class="mb-2 flex items-center justify-between gap-3">
							<p class="hud-eyebrow tracking-[0.22em]">Style Drawer</p>
							<span class="hud-numeric text-[10px] text-[var(--hud-muted)]">
								{lineStyle} · {lineEnd} · {lineWidth}
							</span>
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<div class={toolbarGroup}>
								<div class="flex gap-1">
									{#each colors as swatch}
										<button
											aria-label={`Select ${swatch} annotation color`}
											class="h-5 w-5 rounded-sm border-2 transition {color === swatch
												? 'scale-110 border-white'
												: 'border-transparent hover:border-[var(--hud-dim)]/40'}"
											style="background: {swatch}"
											onclick={() => {
												color = swatch;
												if (toolMode !== 'stamp') {
													toolMode = toolMode === 'shape' ? 'shape' : 'pen';
												}
											}}
										></button>
									{/each}
								</div>
								<input
									type="range"
									min="1"
									max="12"
									step="1"
									bind:value={lineWidth}
									class="w-20 accent-[var(--hud-teal)]"
								/>
								<span class="hud-numeric min-w-[2ch] text-[10px] text-[var(--hud-muted)]">{lineWidth}</span>
							</div>

							<div class={toolbarGroup}>
								{#each lineStyleButtons as button}
									<button
										class="{tbtn} {lineStyle === button.value ? tActive : tIdle} disabled:opacity-35"
										onclick={() => (lineStyle = button.value)}
										disabled={!lineControlsEnabled}
										title={`${button.label} stroke`}
									>
										{button.label}
									</button>
								{/each}
							</div>

							<div class={toolbarGroup}>
								{#each lineEndButtons as button}
									<button
										class="{tbtn} {lineEnd === button.value ? tActive : tIdle} disabled:opacity-35"
										onclick={() => (lineEnd = button.value)}
										disabled={!endControlsEnabled}
										title={`${button.label} line ending`}
									>
										{button.label}
									</button>
								{/each}
							</div>
						</div>
					{:else if activeDrawer === 'markers'}
						<div class="mb-2 flex items-center justify-between gap-3">
							<p class="hud-eyebrow tracking-[0.22em]">Marker Drawer</p>
							<span class="hud-numeric text-[10px] text-[var(--hud-muted)]">{stamps.length} placed</span>
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<div class={toolbarGroup}>
								{#each stampButtons as button}
									<button
										class="{tbtn} flex items-center gap-1 {isActiveStamp(button.stamp, button.side) ? tActive : tIdle}"
										onclick={() => selectStamp(button.stamp, button.side)}
										title={button.label}
									>
										<span
											class="inline-block h-1.5 w-1.5 rounded-full"
											style="background: {button.side === 'friendly' ? FRIENDLY_COLOR : ENEMY_COLOR}"
										></span>
										{button.label}
									</button>
								{/each}
							</div>

							{#if selectedStamp?.stamp === 'tank' && selectedStampTank}
								<div class={toolbarGroup}>
									<div class="flex flex-col leading-none">
										<span class="hud-eyebrow text-[10px] tracking-[0.22em]">{selectedStampTank.name}</span>
										<span class="hud-numeric text-[10px] text-[var(--hud-muted)]">
											{Math.round(selectedStampTank.vision)}m vision radius
										</span>
									</div>
									<button
										class="{tbtn} {selectedStamp.showVision ? tActive : tIdle}"
										onclick={() => toggleStampVision(selectedStamp.id)}
										title="Toggle vision ring for this hull"
									>
										{selectedStamp.showVision ? 'Hide Vision' : 'Show Vision'}
									</button>
								</div>
							{/if}
						</div>
					{:else}
						<div class="mb-2 flex items-center justify-between gap-3">
							<p class="hud-eyebrow tracking-[0.22em]">Action Drawer</p>
							<span class="hud-numeric text-[10px] text-[var(--hud-muted)]">
								{zoom === 1 ? '1' : zoom.toFixed(1)}x
							</span>
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<div class={toolbarGroup}>
								<button
									class="{tbtn} {tIdle} disabled:opacity-30"
									onclick={() => setZoom(zoom - ZOOM_STEP)}
									disabled={zoom <= ZOOM_MIN}
									title="Zoom out (Ctrl+Scroll)"
								>
									&#x2212;
								</button>
								<span class="hud-numeric min-w-[3ch] text-center text-[10px] text-[var(--hud-muted)]">
									{zoom === 1 ? '1' : zoom.toFixed(1)}x
								</span>
								<button
									class="{tbtn} {tIdle} disabled:opacity-30"
									onclick={() => setZoom(zoom + ZOOM_STEP)}
									disabled={zoom >= ZOOM_MAX}
									title="Zoom in (Ctrl+Scroll)"
								>
									+
								</button>
								{#if zoom > 1}
									<button class="{tbtn} {tIdle}" onclick={() => (zoom = 1)} title="Reset zoom">
										Reset
									</button>
								{/if}
							</div>

							<div class={toolbarGroup}>
								<button class="{tbtn} {tIdle} disabled:opacity-30" onclick={exportPng} disabled={!hasContent}>
									Export
								</button>
								{#if isRoomMode}
									<button class="{tbtn} {tIdle}" onclick={copyRoomLink}>
										{copyRoomLinkLabel}
									</button>
								{:else}
									<button class="{tbtn} {tIdle} disabled:opacity-30" onclick={shareUrl} disabled={!hasContent}>
										{shareStatus === 'copied' ? 'Copied!' : 'Share'}
									</button>
								{/if}
								{#if canStartLiveRoom}
									<button class="{tbtn} {tIdle} disabled:opacity-30" onclick={startLiveRoom} disabled={liveRoomBusy}>
										{liveRoomBusy ? 'Starting…' : 'Live Room'}
									</button>
								{/if}
								<button class="{tbtn} {tIdle} disabled:opacity-30" onclick={undo} disabled={isRoomMode || undoStack.length === 0}>
									Undo
								</button>
								<button class="{tbtn} {tIdle} disabled:opacity-30" onclick={redo} disabled={isRoomMode || redoStack.length === 0}>
									Redo
								</button>
								<button class="{tbtn} {tIdle} disabled:opacity-30" onclick={clearAll} disabled={!hasContent}>
									Clear
								</button>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<div
			class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--hud-outline-variant)]/40 pt-2 text-[10px] uppercase tracking-[0.18em] text-[var(--hud-dim)]"
		>
			<span>
				{#if selectedShape}
					Selected {selectedShape.kind}. Drag it to reposition, or press Delete to clear it.
				{:else if isRoomMode}
					Live room sync publishes each completed action. In-progress brush strokes stay local until release.
				{:else}
					Open the drawers to tune style, markers, and actions without crowding the command bar.
				{/if}
			</span>
			<span>
				{isRoomMode
					? 'Eraser removes whole objects. Anonymous guests need a callsign before editing.'
					: 'Eraser removes whole lines, shapes, and markers. Click a hull token to rotate chassis. Measure is temporary.'}
			</span>
		</div>
	</div>
</div>
