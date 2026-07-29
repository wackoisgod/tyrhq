<script lang="ts">
	import { T, useThrelte } from '@threlte/core';
	import { OrbitControls } from '@threlte/extras';
	import {
		Box3,
		InstancedMesh,
		Matrix4,
		Mesh as ThreeMesh,
		MeshBasicMaterial,
		MeshStandardMaterial,
		Object3D,
		PlaneGeometry,
		Vector3,
		type BufferGeometry,
		type Material
	} from 'three';
	import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
	import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

	type ModelDimensions = { length: number; width: number; height: number };

	let {
		tanks,
		onmeasure,
		onsettled
	}: {
		tanks: Array<{ id: string; accent: string }>;
		/** Reports real-world model dimensions (metres) once a model is placed. */
		onmeasure: (vehicleId: string, dims: ModelDimensions) => void;
		/** Fires when the current batch finishes loading, with the ids that made it in. */
		onsettled: (loadedIds: string[]) => void;
	} = $props();

	const { scene, invalidate } = useThrelte();
	const gltfLoader = new GLTFLoader();

	const FALLBACK_VISUAL_COLOR = 0x66746d;
	const LAYOUT_GAP = 1.6;

	let cameraPosition = $state<[number, number, number]>([5, 4, 10]);
	let cameraTarget = $state<[number, number, number]>([0, 1, 0]);

	function loadGltf(url: string) {
		return new Promise<GLTF | null>((resolve) => {
			gltfLoader.load(url, resolve, undefined, () => resolve(null));
		});
	}

	function findFirstMesh(root: Object3D): ThreeMesh | null {
		// Assigned inside a closure, so declare the return type explicitly — TS
		// otherwise narrows `found` back to null at the return.
		let found: ThreeMesh | null = null;
		root.traverse((child) => {
			if (found || !(child as ThreeMesh).isMesh) return;
			found = child as ThreeMesh;
		});
		return found;
	}

	function disposeMaterial(material: Material | Material[] | undefined) {
		if (!material) return;
		if (Array.isArray(material)) {
			for (const entry of material) entry.dispose();
			return;
		}
		material.dispose();
	}

	function disposeObject(root: Object3D | null) {
		if (!root) return;
		root.traverse((child) => {
			const mesh = child as ThreeMesh;
			if (mesh.geometry) mesh.geometry.dispose?.();
			disposeMaterial(mesh.material as Material | Material[] | undefined);
		});
	}

	type TrackTread = { mesh: string; instances: number[][] };
	type TracksData = { treads: TrackTread[] };

	// Same baked-instance track reconstruction the armor viewer uses: tread links
	// are separate GLBs instanced along the authored spline, and without them a
	// tracked hull renders with bare road wheels.
	async function loadTracks(vehicleId: string): Promise<Object3D | null> {
		const data = await fetch(`/models/vehicles/${vehicleId}-tracks.json`)
			.then((response) => (response.ok ? (response.json() as Promise<TracksData>) : null))
			.catch(() => null);
		if (!data?.treads?.length) return null;

		const group = new Object3D();
		const matrix = new Matrix4();
		for (const tread of data.treads) {
			if (!tread.instances?.length) continue;
			const gltf = await loadGltf(`/models/vehicles/${tread.mesh}`);
			const mesh = gltf ? findFirstMesh(gltf.scene) : null;
			if (!mesh) continue;
			const instanced = new InstancedMesh(
				mesh.geometry as BufferGeometry,
				mesh.material as Material | Material[],
				tread.instances.length
			);
			instanced.frustumCulled = false;
			tread.instances.forEach((values, index) => {
				matrix.fromArray(values);
				instanced.setMatrixAt(index, matrix);
			});
			instanced.instanceMatrix.needsUpdate = true;
			group.add(instanced);
		}
		return group.children.length > 0 ? group : null;
	}

	async function loadVehicleRoot(vehicleId: string): Promise<Object3D | null> {
		const visual = await loadGltf(`/models/vehicles/${vehicleId}-visual.glb`);
		if (visual) return visual.scene;

		// No published visual scene — fall back to the armor mesh with a flat
		// material, mirroring the armor viewer's fallback.
		const armor = await loadGltf(`/models/vehicles/${vehicleId}.glb`);
		if (!armor) return null;
		const root = cloneSkeleton(armor.scene) as Object3D;
		root.updateMatrixWorld(true);
		root.traverse((child) => {
			const mesh = child as ThreeMesh;
			if (!mesh.isMesh) return;
			disposeMaterial(mesh.material as Material | Material[] | undefined);
			mesh.material = new MeshStandardMaterial({
				color: FALLBACK_VISUAL_COLOR,
				metalness: 0.18,
				roughness: 0.8
			});
		});
		return root;
	}

	async function loadVehicle(vehicleId: string) {
		const [root, tracks] = await Promise.all([loadVehicleRoot(vehicleId), loadTracks(vehicleId)]);
		if (!root) {
			if (tracks) disposeObject(tracks);
			return null;
		}
		if (tracks) root.add(tracks);
		root.traverse((child) => {
			if ((child as ThreeMesh).isMesh) (child as ThreeMesh).frustumCulled = false;
		});
		root.updateMatrixWorld(true);
		return { vehicleId, root };
	}

	function buildBaseMarker(size: Vector3, accent: string) {
		const marker = new ThreeMesh(
			new PlaneGeometry(size.x + 0.5, size.z + 0.5),
			new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.14, depthWrite: false })
		);
		marker.rotation.x = -Math.PI / 2;
		marker.position.y = 0.005;
		return marker;
	}

	$effect(() => {
		const batch = tanks.map((tank) => ({ ...tank }));
		let cancelled = false;
		const batchRoot = new Object3D();
		batchRoot.name = 'CompareLineup';

		Promise.all(batch.map((tank) => loadVehicle(tank.id))).then((entries) => {
			if (cancelled) {
				for (const entry of entries) {
					if (entry) disposeObject(entry.root);
				}
				return;
			}

			const placed: Array<{ vehicleId: string; wrapper: Object3D; box: Box3; size: Vector3 }> = [];
			for (const entry of entries) {
				if (!entry) continue;
				const box = new Box3().setFromObject(entry.root);
				if (box.isEmpty()) {
					disposeObject(entry.root);
					continue;
				}
				const wrapper = new Object3D();
				wrapper.add(entry.root);
				placed.push({ vehicleId: entry.vehicleId, wrapper, box, size: box.getSize(new Vector3()) });
			}

			// The exported hulls share one facing convention, discovered from the
			// footprints (tanks are longer than wide). Park the lineup abreast along
			// the lateral axis so vehicles sit gun-to-gun instead of nose-to-tail.
			const lengthAlongX =
				placed.reduce((vote, entry) => vote + (entry.size.x >= entry.size.z ? 1 : -1), 0) >= 0;
			const lateral = (size: Vector3) => (lengthAlongX ? size.z : size.x);
			const facing = (size: Vector3) => (lengthAlongX ? size.x : size.z);

			const totalSpan =
				placed.reduce((sum, entry) => sum + lateral(entry.size), 0) +
				LAYOUT_GAP * Math.max(0, placed.length - 1);

			let cursor = lengthAlongX ? totalSpan / 2 : -totalSpan / 2;
			let maxHeight = 0;
			let maxLength = 0;
			for (const entry of placed) {
				// Rest the bounding box on the ground plane, centred on the facing
				// axis, marching abreast in selection order. The march runs toward
				// screen-left → screen-right for the camera chosen below, so models
				// line up in the same order as the stat columns.
				const centerFacingX = -(entry.box.min.x + entry.box.max.x) / 2;
				const centerFacingZ = -(entry.box.min.z + entry.box.max.z) / 2;
				if (lengthAlongX) {
					entry.wrapper.position.set(centerFacingX, -entry.box.min.y, cursor - entry.box.max.z);
					cursor -= entry.size.z + LAYOUT_GAP;
				} else {
					entry.wrapper.position.set(cursor - entry.box.min.x, -entry.box.min.y, centerFacingZ);
					cursor += entry.size.x + LAYOUT_GAP;
				}
				maxHeight = Math.max(maxHeight, entry.size.y);
				maxLength = Math.max(maxLength, facing(entry.size));

				const accent = batch.find((tank) => tank.id === entry.vehicleId)?.accent ?? '#99f7ff';
				const marker = buildBaseMarker(entry.size, accent);
				marker.position.x = entry.wrapper.position.x + (entry.box.min.x + entry.box.max.x) / 2;
				marker.position.z = entry.wrapper.position.z + (entry.box.min.z + entry.box.max.z) / 2;
				batchRoot.add(marker);

				batchRoot.add(entry.wrapper);
				onmeasure(entry.vehicleId, {
					length: facing(entry.size),
					width: lateral(entry.size),
					height: entry.size.y
				});
			}

			if (placed.length > 0) {
				const span = Math.max(totalSpan, 4);
				// Stand back along the facing axis (with room for the hull depth) and
				// step aside just enough for a three-quarter view, so the lineup
				// spreads across the screen without the near hull occluding the rest.
				const standoff = span * 0.6 + maxLength * 0.75 + 2;
				const aside = span * 0.25;
				const eyeHeight = Math.max(2.4, maxHeight * 1.5);
				cameraTarget = [0, Math.min(1.6, maxHeight * 0.45), 0];
				cameraPosition = lengthAlongX
					? [standoff, eyeHeight, aside]
					: [aside, eyeHeight, standoff];
			}

			scene.add(batchRoot);
			onsettled(placed.map((entry) => entry.vehicleId));
			invalidate();
		});

		return () => {
			cancelled = true;
			scene.remove(batchRoot);
			disposeObject(batchRoot);
			invalidate();
		};
	});
</script>

<T.PerspectiveCamera makeDefault position={cameraPosition} fov={40}>
	<OrbitControls
		enableDamping
		dampingFactor={0.15}
		minDistance={2}
		maxDistance={60}
		enablePan={true}
		target={cameraTarget}
	/>
</T.PerspectiveCamera>

<T.AmbientLight intensity={0.7} />
<T.DirectionalLight position={[5, 8, 5]} intensity={0.8} />
<T.DirectionalLight position={[-3, 4, -5]} intensity={0.4} />

<!-- 1 m grid cells so the lineup reads as real scale. -->
<T.GridHelper args={[40, 40, '#2a4a3a', '#1a2e24']} position.y={-0.01} />
