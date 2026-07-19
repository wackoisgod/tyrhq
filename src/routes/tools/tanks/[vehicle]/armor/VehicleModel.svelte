<script lang="ts">
	import { T, useTask, useThrelte } from '@threlte/core';
	import { OrbitControls, interactivity, useFBO, useInteractivity } from '@threlte/extras';
	import type { ArmorHitInfo } from './types';
	import {
		BufferAttribute,
		BufferGeometry,
		Color,
		AnimationMixer,
		FrontSide,
		InstancedMesh,
		LinearFilter,
		LoopOnce,
		LoopRepeat,
		Matrix4,
		Mesh as ThreeMesh,
		MeshStandardMaterial,
		NearestFilter,
		Object3D,
		OrthographicCamera,
		PlaneGeometry,
		Scene,
		ShaderMaterial,
		Vector2,
		Vector3,
		Quaternion,
		type AnimationAction,
		type AnimationClip,
		type Material
	} from 'three';
	import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
	import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

	type ArmorData = {
		vehicleId: string;
		textureWidth: number;
		textureHeight: number;
		triangles: [number, number][];
		isModule: number[];
		isAbsorb?: number[];
		sectionIds?: number[];
	};

	type DeployedClipName = 'enter' | 'idle' | 'exit';
	type DeployedAnimationSet = Partial<Record<DeployedClipName, AnimationClip>>;
	type DeployedBasePose = Map<
		string,
		{
			position: Vector3;
			quaternion: Quaternion;
			scale: Vector3;
		}
	>;

	let {
		vehicleId,
		onhover,
		onclick,
		shellPenetration = 50,
		showArmorVisualizer = true,
		hasDeployedAnimations = false,
		deployedMode = false
	}: {
		vehicleId: string;
		onhover: (info: ArmorHitInfo | null) => void;
		onclick: (info: ArmorHitInfo | null) => void;
		shellPenetration?: number;
		showArmorVisualizer?: boolean;
		hasDeployedAnimations?: boolean;
		deployedMode?: boolean;
	} = $props();

	interactivity();

	const { scene, renderer, camera, autoRender, renderStage, invalidate } = useThrelte();
	const { addInteractiveObject, removeInteractiveObject } = useInteractivity();

	const armorFillTarget = useFBO({
		minFilter: LinearFilter,
		magFilter: LinearFilter
	});
	const armorMetaTarget = useFBO({
		minFilter: NearestFilter,
		magFilter: NearestFilter
	});

	const armorScene = new Scene();
	const overlayScene = new Scene();
	const overlayCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
	overlayCamera.position.z = 1;

	let armorRoot: Object3D | null = null;
	let armorMesh: ThreeMesh | null = $state(null);
	let armorPickMesh: Object3D | null = $state(null);
	let armorData: ArmorData | null = $state(null);
	let armorFillMaterial: ShaderMaterial | null = null;
	let armorMetaMaterial: ShaderMaterial | null = null;
	let visualRoot: Object3D | null = $state(null);
	let deployedAnimationClips: DeployedAnimationSet | null = $state(null);
	let deployedAnimationMixer: AnimationMixer | null = null;
	let deployedAnimationAction: AnimationAction | null = null;
	let deployedAnimationRunning = $state(false);
	let deployedBasePose: DeployedBasePose | null = null;

	type TrackBoneRest = { node: Object3D; rest: Matrix4; pos: Vector3 };
	type TrackSkinPart = { mesh: InstancedMesh; bones: Object3D[]; relatives: Matrix4[] };
	let trackSkinParts: TrackSkinPart[] | null = null;
	let trackSkinRoot: Object3D | null = null;
	const trackSkinInvRoot = new Matrix4();
	const trackSkinTmp = new Matrix4();
	let lastSyncedDeployedMode: boolean | null = null;

	const AUTO_BOUNCE_ANGLE = 80;
	const OVERMATCH_MULTIPLIER = 4.0;
	const HALF_CHANCE_PEN_MULTIPLIER = 1.1;
	const FALLBACK_VISUAL_COLOR = new Color(0x66746d);
	const gltfLoader = new GLTFLoader();
	const armorVisualizerActive = $derived(showArmorVisualizer);
	let lastAnimationTime = performance.now();

	const armorVertexShader = `
		attribute float armorThickness;
		attribute float isModule;
		attribute float isAbsorb;
		attribute float isFiftyFifty;
		attribute float sectionKeyId;

		varying float vThickness;
		varying float vIsModule;
		varying float vIsAbsorb;
		varying float vIsFiftyFifty;
		varying float vSectionKeyId;
		varying vec3 vWorldNormal;
		varying vec3 vWorldPos;

		#include <skinning_pars_vertex>

		void main() {
			vThickness = armorThickness;
			vIsModule = isModule;
			vIsAbsorb = isAbsorb;
			vIsFiftyFifty = isFiftyFifty;
			vSectionKeyId = sectionKeyId;

			#include <skinbase_vertex>

			vec3 objectNormal = vec3(normal);
			#include <skinnormal_vertex>

			vec3 transformed = vec3(position);
			#include <skinning_vertex>

			vWorldNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
			vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
			vWorldPos = worldPos.xyz;
			gl_Position = projectionMatrix * viewMatrix * worldPos;
		}
	`;

	const armorClassifyShader = `
		void classifyArmor(out vec3 fillColor, out vec3 outlineColor, out float mask) {
			fillColor = vec3(0.0);
			outlineColor = vec3(0.0);
			mask = 0.0;

			if (vIsModule > 0.5) {
				fillColor = vec3(0.09, 0.20, 0.75);
				outlineColor = vec3(0.00, 0.23, 1.00);
				mask = 1.0;
				return;
			}

			if (vThickness < 0.5) {
				return;
			}

			vec3 viewDir = normalize(cameraPosition - vWorldPos);
			float cosAngle = abs(dot(normalize(vWorldNormal), viewDir));
			float angleDeg = degrees(acos(clamp(cosAngle, 0.0, 1.0)));
			float effectiveThickness = vThickness / max(cosAngle, 0.001);

			if (shellPen > overmatchMult * vThickness) {
				fillColor = vec3(0.09, 0.35, 0.31);
				outlineColor = vec3(0.26, 1.00, 0.76);
				mask = 1.0;
				return;
			}

			if (angleDeg > autoBounceAngle) {
				fillColor = vec3(0.03, 0.04, 0.08);
				outlineColor = vec3(0.40, 0.41, 0.50);
				mask = 1.0;
				return;
			}

			if (
				vIsFiftyFifty > 0.5 &&
				shellPen <= effectiveThickness &&
				(shellPen * 1.1) > effectiveThickness
			) {
				fillColor = vec3(0.35, 0.23, 0.00);
				outlineColor = vec3(1.00, 0.83, 0.00);
				mask = 1.0;
				return;
			}

			if (shellPen > effectiveThickness) {
				fillColor = vec3(0.09, 0.35, 0.31);
				outlineColor = vec3(0.26, 1.00, 0.76);
				mask = 1.0;
				return;
			}

			fillColor = vec3(0.03, 0.04, 0.08);
			outlineColor = vec3(0.40, 0.41, 0.50);
			mask = 1.0;
		}
	`;

	const armorFillFragmentShader = `
		uniform float shellPen;
		uniform float autoBounceAngle;
		uniform float overmatchMult;

		varying float vThickness;
		varying float vIsModule;
		varying float vIsAbsorb;
		varying float vIsFiftyFifty;
		varying float vSectionKeyId;
		varying vec3 vWorldNormal;
		varying vec3 vWorldPos;

		${armorClassifyShader}

		void main() {
			vec3 fillColor;
			vec3 outlineColor;
			float mask;
			classifyArmor(fillColor, outlineColor, mask);
			gl_FragColor = vec4(fillColor, mask);
		}
	`;

	const armorMetaFragmentShader = `
		uniform float shellPen;
		uniform float autoBounceAngle;
		uniform float overmatchMult;

		varying float vThickness;
		varying float vIsModule;
		varying float vIsAbsorb;
		varying float vIsFiftyFifty;
		varying float vSectionKeyId;
		varying vec3 vWorldNormal;
		varying vec3 vWorldPos;

		${armorClassifyShader}

		void main() {
			vec3 fillColor;
			vec3 outlineColor;
			float mask;
			classifyArmor(fillColor, outlineColor, mask);

			float encodedSection = mask > 0.5 ? (vSectionKeyId + 1.0) / 255.0 : 0.0;
			gl_FragColor = vec4(outlineColor, encodedSection);
		}
	`;

	const compositeVertexShader = `
		varying vec2 vUv;

		void main() {
			vUv = uv;
			gl_Position = vec4(position.xy, 0.0, 1.0);
		}
	`;

	const compositeFragmentShader = `
		uniform sampler2D fillTex;
		uniform sampler2D metaTex;
		uniform vec2 texelSize;
		uniform float fillOpacity;
		uniform float outlineOpacity;
		uniform float outlineThickness;

		varying vec2 vUv;

		float getMask(vec4 metaSample) {
			return step(0.0001, metaSample.a);
		}

		vec4 readMeta(vec2 direction) {
			vec2 uv = clamp(vUv + direction * texelSize * outlineThickness, vec2(0.0), vec2(1.0));
			return texture2D(metaTex, uv);
		}

		void compareNeighbor(vec4 centerMeta, vec2 direction, inout float boundary) {
			vec4 sampleMeta = readMeta(direction);
			float centerMask = getMask(centerMeta);
			float sampleMask = getMask(sampleMeta);
			boundary = max(boundary, abs(centerMask - sampleMask));
			if (centerMask > 0.5 && sampleMask > 0.5) {
				boundary = max(boundary, step(0.001, abs(sampleMeta.a - centerMeta.a)));
			}
		}

		void gatherOutsideOutline(vec2 direction, inout float hits, inout vec3 colorSum) {
			vec4 sampleMeta = readMeta(direction);
			float sampleMask = getMask(sampleMeta);
			if (sampleMask > 0.5) {
				hits += 1.0;
				colorSum += sampleMeta.rgb;
			}
		}

		void main() {
			vec4 fill = texture2D(fillTex, vUv);
			vec4 meta = texture2D(metaTex, vUv);
			float centerMask = getMask(meta);

			if (centerMask > 0.5) {
				float boundary = 0.0;
				compareNeighbor(meta, vec2(1.0, 0.0), boundary);
				compareNeighbor(meta, vec2(-1.0, 0.0), boundary);
				compareNeighbor(meta, vec2(0.0, 1.0), boundary);
				compareNeighbor(meta, vec2(0.0, -1.0), boundary);
				compareNeighbor(meta, vec2(1.0, 1.0), boundary);
				compareNeighbor(meta, vec2(-1.0, 1.0), boundary);
				compareNeighbor(meta, vec2(1.0, -1.0), boundary);
				compareNeighbor(meta, vec2(-1.0, -1.0), boundary);

				vec3 color = fill.rgb;
				float alpha = fillOpacity;
				if (boundary > 0.0) {
					color = meta.rgb;
					alpha = max(alpha, outlineOpacity);
				}

				gl_FragColor = vec4(color, alpha);
				return;
			}

			float outsideHits = 0.0;
			vec3 outsideColor = vec3(0.0);
			gatherOutsideOutline(vec2(1.0, 0.0), outsideHits, outsideColor);
			gatherOutsideOutline(vec2(-1.0, 0.0), outsideHits, outsideColor);
			gatherOutsideOutline(vec2(0.0, 1.0), outsideHits, outsideColor);
			gatherOutsideOutline(vec2(0.0, -1.0), outsideHits, outsideColor);
			gatherOutsideOutline(vec2(1.0, 1.0), outsideHits, outsideColor);
			gatherOutsideOutline(vec2(-1.0, 1.0), outsideHits, outsideColor);
			gatherOutsideOutline(vec2(1.0, -1.0), outsideHits, outsideColor);
			gatherOutsideOutline(vec2(-1.0, -1.0), outsideHits, outsideColor);

			if (outsideHits <= 0.0) {
				discard;
			}

			gl_FragColor = vec4(outsideColor / outsideHits, outlineOpacity * 0.85);
		}
	`;

	const compositeMaterial = new ShaderMaterial({
		vertexShader: compositeVertexShader,
		fragmentShader: compositeFragmentShader,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		uniforms: {
			fillTex: { value: armorFillTarget.texture },
			metaTex: { value: armorMetaTarget.texture },
			texelSize: { value: new Vector2(1, 1) },
			fillOpacity: { value: 0.42 },
			outlineOpacity: { value: 0.92 },
			outlineThickness: { value: 1.35 }
		}
	});
	compositeMaterial.toneMapped = false;

	const overlayQuad = new ThreeMesh(new PlaneGeometry(2, 2), compositeMaterial);
	overlayQuad.frustumCulled = false;
	overlayScene.add(overlayQuad);

	function getTriangleSectionKey(data: ArmorData, tri: number) {
		const sectionId = data.sectionIds?.[tri];
		if (sectionId != null) {
			return `${sectionId}|${data.isModule?.[tri] ?? 0}`;
		}

		const [thickness, fiftyFifty] = data.triangles[tri];
		return `${thickness}|${fiftyFifty}|${data.isModule?.[tri] ?? 0}`;
	}

	function findFirstMesh(root: Object3D) {
		let found: Object3D | null = null;

		root.traverse((child) => {
			if (found || !(child as any).isMesh) return;
			found = child;
		});

		return found;
	}

	function configurePickMesh(root: Object3D) {
		root.traverse((child) => {
			if (!(child as any).isMesh) return;
			const material = (child as any).material as Material | Material[] | undefined;
			if (!material) return;
			if (Array.isArray(material)) {
				for (const entry of material) {
					(entry as any).side = FrontSide;
					(entry as any).needsUpdate = true;
				}
				return;
			}
			(material as any).side = FrontSide;
			(material as any).needsUpdate = true;
		});
	}

	function loadArmorData(currentVehicleId: string) {
		return fetch(`/models/vehicles/${currentVehicleId}-armor.json`).then((response) => {
			if (!response.ok) {
				throw new Error(`Failed to load armor data for ${currentVehicleId}`);
			}
			return response.json() as Promise<ArmorData>;
		});
	}

	function loadArmorAsset(currentVehicleId: string) {
		return new Promise<{ root: Object3D; mesh: ThreeMesh }>((resolve, reject) => {
			gltfLoader.load(
				`/models/vehicles/${currentVehicleId}.glb`,
				(gltf) => {
					const root = cloneSkeleton(gltf.scene) as Object3D;
					const mesh = findFirstMesh(root) as ThreeMesh | null;
					if (!mesh) {
						reject(new Error(`No mesh geometry found for ${currentVehicleId}`));
						return;
					}

					configurePickMesh(mesh);
					root.traverse((child) => {
						if (!(child as any).isMesh) return;
						(child as any).frustumCulled = false;
					});
					root.updateMatrixWorld(true);
					if ((mesh as any).skeleton?.update) {
						(mesh as any).skeleton.update();
					}

					resolve({ root, mesh });
				},
				undefined,
				reject
			);
		});
	}

	function loadVisualScene(currentVehicleId: string) {
		return new Promise<Object3D | null>((resolve) => {
			gltfLoader.load(
				`/models/vehicles/${currentVehicleId}-visual.glb`,
				(gltf) => resolve(gltf.scene),
				undefined,
				() => resolve(null)
			);
		});
	}

	type TrackTread = { mesh: string; instances: number[][] };
	type TracksData = { vehicleId: string; treads: TrackTread[] };

	function loadTracksData(currentVehicleId: string) {
		return fetch(`/models/vehicles/${currentVehicleId}-tracks.json`)
			.then((response) => (response.ok ? (response.json() as Promise<TracksData>) : null))
			.catch(() => null);
	}

	function loadGlbMesh(url: string) {
		return new Promise<ThreeMesh | null>((resolve) => {
			gltfLoader.load(
				url,
				(gltf) => resolve(findFirstMesh(gltf.scene) as ThreeMesh | null),
				undefined,
				() => resolve(null)
			);
		});
	}

	// Tracks are one or more tread-link meshes (left/right may differ) instanced
	// along the authored spline; per-link transforms are baked (glTF space) into
	// <id>-tracks.json by the exporter. Returns a group of InstancedMeshes.
	async function buildTracks(tracksData: TracksData | null): Promise<Object3D | null> {
		if (!tracksData?.treads?.length) return null;
		const group = new Object3D();
		group.name = 'ProceduralTracks';
		const matrix = new Matrix4();
		for (const tread of tracksData.treads) {
			if (!tread.instances?.length) continue;
			const mesh = await loadGlbMesh(`/models/vehicles/${tread.mesh}`);
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
		return group.children.length ? group : null;
	}

	// Track/wheel/suspension bones (the ones that fold a tank's tracks during deploy).
	const TRACK_BONE_PATTERN = /wheel|tread|cog|susp/;

	function gatherTrackBones(root: Object3D): TrackBoneRest[] {
		root.updateWorldMatrix(true, true);
		const invRoot = new Matrix4().copy(root.matrixWorld).invert();
		const bones: TrackBoneRest[] = [];
		root.traverse((node) => {
			const name = node.name.toLowerCase();
			if (!name.startsWith('jnt_') || !TRACK_BONE_PATTERN.test(name)) return;
			const rest = new Matrix4().multiplyMatrices(invRoot, node.matrixWorld);
			bones.push({ node, rest, pos: new Vector3().setFromMatrixPosition(rest) });
		});
		return bones;
	}

	// Bind each baked tread instance to its nearest track/wheel bone so the tracks
	// follow the skeleton (e.g. VTOL folding its tracks on deploy). `relatives[i]` is
	// the instance expressed in that bone's rest frame; each frame we recombine it
	// with the bone's live transform. The in-game tracks reshape a spline from these
	// same bones — this is a per-link approximation of that.
	function bindTrackSkinning(group: Object3D, bones: TrackBoneRest[]): TrackSkinPart[] | null {
		if (!bones.length) return null;
		const parts: TrackSkinPart[] = [];
		const instMat = new Matrix4();
		const instPos = new Vector3();
		group.traverse((child) => {
			const mesh = child as InstancedMesh;
			if (!(mesh as { isInstancedMesh?: boolean }).isInstancedMesh) return;
			const boneNodes: Object3D[] = [];
			const relatives: Matrix4[] = [];
			for (let i = 0; i < mesh.count; i++) {
				mesh.getMatrixAt(i, instMat);
				instPos.setFromMatrixPosition(instMat);
				let best = bones[0];
				let bestDist = Infinity;
				for (const bone of bones) {
					const dist = instPos.distanceToSquared(bone.pos);
					if (dist < bestDist) {
						bestDist = dist;
						best = bone;
					}
				}
				boneNodes.push(best.node);
				relatives.push(new Matrix4().copy(best.rest).invert().multiply(instMat));
			}
			parts.push({ mesh, bones: boneNodes, relatives });
		});
		return parts;
	}

	function updateTrackSkinning() {
		if (!trackSkinParts || !trackSkinRoot) return;
		trackSkinInvRoot.copy(trackSkinRoot.matrixWorld).invert();
		for (const part of trackSkinParts) {
			for (let i = 0; i < part.bones.length; i++) {
				trackSkinTmp
					.multiplyMatrices(trackSkinInvRoot, part.bones[i].matrixWorld)
					.multiply(part.relatives[i]);
				part.mesh.setMatrixAt(i, trackSkinTmp);
			}
			part.mesh.instanceMatrix.needsUpdate = true;
		}
	}

	function loadDeployedAnimationClip(currentVehicleId: string, clipName: DeployedClipName) {
		return new Promise<AnimationClip | null>((resolve) => {
			gltfLoader.load(
				`/models/vehicles/${currentVehicleId}-deployed-${clipName}.glb`,
				(gltf) => {
					const clip = gltf.animations[0]?.clone() ?? null;
					disposeObject(gltf.scene);
					resolve(clip);
				},
				undefined,
				() => resolve(null)
			);
		});
	}

	// Deployed clips ship in two authoring formats: older exports store each track as an
	// offset from the bind pose ("delta"), while newer exports bake the final local
	// transform ("absolute"). Combining an absolute clip with the bind pose again doubles
	// every joint and scatters the model apart, so we detect the format before normalizing.
	// Heuristic: for joints that sit away from the origin, the average position over the
	// clip lands near the bind pose for absolute clips and near zero for delta clips.
	function isDeltaPoseClip(clip: AnimationClip, nodesByName: Map<string, Object3D>) {
		let absoluteVotes = 0;
		let deltaVotes = 0;

		for (const track of clip.tracks) {
			const separatorIndex = track.name.lastIndexOf('.');
			if (separatorIndex < 1) continue;
			if (track.name.slice(separatorIndex + 1) !== 'position') continue;

			const target = nodesByName.get(track.name.slice(0, separatorIndex));
			if (!target) continue;

			const base = target.position;
			// Joints sitting at the origin read the same in both formats, so they can't vote.
			if (base.length() < 0.1) continue;

			const frameCount = track.values.length / 3;
			if (frameCount === 0) continue;

			let meanX = 0;
			let meanY = 0;
			let meanZ = 0;
			for (let index = 0; index < track.values.length; index += 3) {
				meanX += track.values[index];
				meanY += track.values[index + 1];
				meanZ += track.values[index + 2];
			}
			meanX /= frameCount;
			meanY /= frameCount;
			meanZ /= frameCount;

			const distanceToAbsolute = Math.hypot(meanX - base.x, meanY - base.y, meanZ - base.z);
			const distanceToDelta = Math.hypot(meanX, meanY, meanZ);
			if (distanceToDelta <= distanceToAbsolute) {
				deltaVotes += 1;
			} else {
				absoluteVotes += 1;
			}
		}

		// Default to delta when there is no usable signal so legacy offset-authored clips
		// keep working unchanged.
		return deltaVotes >= absoluteVotes;
	}

	function normalizeDeployedAnimationClip(clip: AnimationClip | null, root: Object3D) {
		if (!clip) return null;

		const nodesByName = new Map<string, Object3D>();
		root.traverse((child) => {
			if (child.name) {
				nodesByName.set(child.name, child);
			}
		});

		const sanitizedClip = clip.clone();
		const treatAsDelta = isDeltaPoseClip(sanitizedClip, nodesByName);
		sanitizedClip.tracks = sanitizedClip.tracks.filter((track) => {
			const separatorIndex = track.name.lastIndexOf('.');
			if (separatorIndex < 1) return true;

			const targetName = track.name.slice(0, separatorIndex);
			const propertyName = track.name.slice(separatorIndex + 1);
			const target = nodesByName.get(targetName);
			if (!target) return true;

			if (propertyName === 'scale') {
				return !track.values.every((value) => Math.abs(value) < 0.000001);
			}

			// Absolute clips already hold the final local transform; only delta clips need
			// to be combined with the bind pose.
			if (!treatAsDelta) return true;

			if (propertyName === 'position') {
				for (let index = 0; index < track.values.length; index += 3) {
					track.values[index] += target.position.x;
					track.values[index + 1] += target.position.y;
					track.values[index + 2] += target.position.z;
				}
			}

			if (propertyName === 'quaternion') {
				const baseRotation = target.quaternion.clone();
				const deltaRotation = new Quaternion();
				for (let index = 0; index < track.values.length; index += 4) {
					deltaRotation.set(
						track.values[index],
						track.values[index + 1],
						track.values[index + 2],
						track.values[index + 3]
					);
					const combinedRotation = deltaRotation.clone().multiply(baseRotation).normalize();
					track.values[index] = combinedRotation.x;
					track.values[index + 1] = combinedRotation.y;
					track.values[index + 2] = combinedRotation.z;
					track.values[index + 3] = combinedRotation.w;
				}
			}

			return true;
		});
		sanitizedClip.resetDuration();
		return sanitizedClip;
	}

	async function loadDeployedAnimationClips(currentVehicleId: string) {
		if (!hasDeployedAnimations) return null;

		const [enter, idle, exit] = await Promise.all([
			loadDeployedAnimationClip(currentVehicleId, 'enter'),
			loadDeployedAnimationClip(currentVehicleId, 'idle'),
			loadDeployedAnimationClip(currentVehicleId, 'exit')
		]);

		return { enter: enter ?? undefined, idle: idle ?? undefined, exit: exit ?? undefined };
	}

	function createArmorMaterial(fragmentShader: string) {
		const material = new ShaderMaterial({
			vertexShader: armorVertexShader,
			fragmentShader,
			side: FrontSide,
			transparent: false,
			uniforms: {
				shellPen: { value: shellPenetration },
				autoBounceAngle: { value: AUTO_BOUNCE_ANGLE },
				overmatchMult: { value: OVERMATCH_MULTIPLIER }
			}
		});
		material.toneMapped = false;
		return material;
	}

	function buildArmorMesh(sourceMesh: ThreeMesh, data: ArmorData) {
		const sourceGeometry = sourceMesh.geometry as BufferGeometry;
		const geometry = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone();
		if (!geometry.getAttribute('normal')) {
			geometry.computeVertexNormals();
		}
		const vertexCount = geometry.attributes.position.count;
		const triCount = vertexCount / 3;
		const thickness = new Float32Array(vertexCount);
		const isModuleAttr = new Float32Array(vertexCount);
		const isAbsorbAttr = new Float32Array(vertexCount);
		const fiftyFiftyAttr = new Float32Array(vertexCount);
		const sectionKeyAttr = new Float32Array(vertexCount);

		const sectionKeyIds = new Map<string, number>();
		let nextSectionKeyId = 1;

		const count = Math.min(triCount, data.triangles.length);
		for (let tri = 0; tri < count; tri++) {
			const [armorThickness, fiftyFiftyFlag] = data.triangles[tri];
			const isModule = data.isModule?.[tri] ?? 0;
			const isAbsorb = data.isAbsorb?.[tri] ?? 0;
			const sectionKey = getTriangleSectionKey(data, tri);
			let sectionKeyId = sectionKeyIds.get(sectionKey);

			if (sectionKeyId == null) {
				sectionKeyId = Math.min(nextSectionKeyId, 254);
				sectionKeyIds.set(sectionKey, sectionKeyId);
				nextSectionKeyId += 1;
			}

			for (let v = 0; v < 3; v++) {
				const vertexIndex = tri * 3 + v;
				thickness[vertexIndex] = armorThickness;
				isModuleAttr[vertexIndex] = isModule;
				isAbsorbAttr[vertexIndex] = isAbsorb;
				fiftyFiftyAttr[vertexIndex] = fiftyFiftyFlag;
				sectionKeyAttr[vertexIndex] = sectionKeyId;
			}
		}

		geometry.setAttribute('armorThickness', new BufferAttribute(thickness, 1));
		geometry.setAttribute('isModule', new BufferAttribute(isModuleAttr, 1));
		geometry.setAttribute('isAbsorb', new BufferAttribute(isAbsorbAttr, 1));
		geometry.setAttribute('isFiftyFifty', new BufferAttribute(fiftyFiftyAttr, 1));
		geometry.setAttribute('sectionKeyId', new BufferAttribute(sectionKeyAttr, 1));

		const fillMaterial = createArmorMaterial(armorFillFragmentShader);
		const metaMaterial = createArmorMaterial(armorMetaFragmentShader);
		disposeMaterial(sourceMesh.material as Material | Material[] | undefined);
		sourceMesh.geometry = geometry;
		sourceMesh.material = fillMaterial;
		const mesh = sourceMesh;
		mesh.frustumCulled = false;
		mesh.userData.armorData = data;
		mesh.userData.fillMaterial = fillMaterial;
		mesh.userData.metaMaterial = metaMaterial;
		return { mesh, fillMaterial, metaMaterial };
	}

	function buildFallbackVisualMesh(sourceGeometry: BufferGeometry) {
		const mesh = new ThreeMesh(
			sourceGeometry.clone(),
			new MeshStandardMaterial({
				color: FALLBACK_VISUAL_COLOR,
				metalness: 0.18,
				roughness: 0.8
			})
		);
		mesh.frustumCulled = false;
		return mesh;
	}

	function prepareVisualScene(root: Object3D) {
		root.traverse((child) => {
			if ((child as any).isMesh) {
				(child as any).frustumCulled = false;
				(child as any).renderOrder = 0;
			}
		});

		return root;
	}

	function captureDeployedBasePose(root: Object3D): DeployedBasePose {
		const pose: DeployedBasePose = new Map();
		root.traverse((child) => {
			if (!child.name) return;
			pose.set(child.name, {
				position: child.position.clone(),
				quaternion: child.quaternion.clone(),
				scale: child.scale.clone()
			});
		});
		return pose;
	}

	function restoreDeployedBasePose(root: Object3D | null = visualRoot, pose = deployedBasePose) {
		if (!root || !pose) return;
		root.traverse((child) => {
			const transform = child.name ? pose.get(child.name) : null;
			if (!transform) return;
			child.position.copy(transform.position);
			child.quaternion.copy(transform.quaternion);
			child.scale.copy(transform.scale);
		});
		root.updateMatrixWorld(true);
		invalidate();
	}

	function copyPoseByName(sourceRoot: Object3D | null = armorRoot, targetRoot: Object3D | null = visualRoot) {
		if (!sourceRoot || !targetRoot) return;

		const sourceNodes = new Map<string, Object3D>();
		sourceRoot.traverse((child) => {
			if (child.name) {
				sourceNodes.set(child.name, child);
			}
		});

		targetRoot.traverse((target) => {
			if (!target.name) return;
			const source = sourceNodes.get(target.name);
			if (!source) return;
			target.position.copy(source.position);
			target.quaternion.copy(source.quaternion);
			target.scale.copy(source.scale);
		});
		targetRoot.updateMatrixWorld(true);
	}

	function disposeMaterial(material: Material | Material[] | undefined) {
		if (!material) return;
		if (Array.isArray(material)) {
			for (const entry of material) {
				entry.dispose();
			}
			return;
		}

		material.dispose();
	}

	function disposeObject(root: Object3D | null) {
		if (!root) return;
		root.traverse((child) => {
			if ((child as any).geometry) {
				(child as any).geometry.dispose?.();
			}
			disposeMaterial((child as any).material as Material | Material[] | undefined);
		});
	}

	function disposeArmorMesh(mesh: ThreeMesh | null) {
		if (!mesh) return;
		(mesh.geometry as BufferGeometry).dispose();
		disposeMaterial(mesh.userData.fillMaterial as Material | undefined);
		disposeMaterial(mesh.userData.metaMaterial as Material | undefined);
	}

	function getPenResult(thickness: number, isFiftyFifty: boolean, angleFromNormal: number): ArmorHitInfo['result'] {
		if (thickness === 0) return 'no_pen';
		if (shellPenetration > OVERMATCH_MULTIPLIER * thickness) return 'overmatch';
		if (angleFromNormal > AUTO_BOUNCE_ANGLE) return 'ricochet';

		const angleRad = (angleFromNormal * Math.PI) / 180;
		const effectiveThickness = thickness / Math.cos(angleRad);
		if (
			isFiftyFifty &&
			shellPenetration <= effectiveThickness &&
			(shellPenetration * HALF_CHANCE_PEN_MULTIPLIER) > effectiveThickness
		) {
			return 'fifty_fifty';
		}

		if (shellPenetration > effectiveThickness) return 'penetrate';
		return 'no_pen';
	}

	function getHitInfo(event: any): ArmorHitInfo | null {
		const faceIndex = event.faceIndex ?? -1;
		if (!armorData || faceIndex < 0 || faceIndex >= armorData.triangles.length) return null;

		const [thickness, fiftyFifty] = armorData.triangles[faceIndex];
		const isModule = armorData.isModule?.[faceIndex] ?? 0;
		const isAbsorb = armorData.isAbsorb?.[faceIndex] ?? 0;

		if (isModule) {
			return {
				thickness: 0,
				angle: 0,
				isFiftyFifty: false,
				result: isAbsorb ? 'absorb' : 'module'
			};
		}

		let angle = 0;
		if (event.face && event.ray) {
			const normal = event.face.normal.clone();
			if (event.object) normal.transformDirection(event.object.matrixWorld);
			const rayDir = event.ray.direction.clone().negate();
			const dot = Math.abs(normal.dot(rayDir));
			angle = Math.acos(Math.min(dot, 1)) * (180 / Math.PI);
		}

		return {
			thickness,
			angle: Math.round(angle * 100) / 100,
			isFiftyFifty: fiftyFifty === 1,
			result: getPenResult(thickness, fiftyFifty === 1, angle)
		};
	}

	function isPrimaryIntersection(event: any) {
		const intersections = event.intersections as any[] | undefined;
		if (!intersections?.length) return true;

		const primary =
			intersections.find((intersection) => intersection.eventObject === event.eventObject) ??
			intersections[0];

		return (
			primary.object === event.object &&
			primary.faceIndex === event.faceIndex &&
			primary.distance === event.distance
		);
	}

	function handlePointerMove(event: any) {
		if (!armorVisualizerActive) return;
		if (!isPrimaryIntersection(event)) return;
		onhover(getHitInfo(event));
	}

	function handlePointerLeave() {
		onhover(null);
	}

	function handlePointerDown(event: any) {
		if (!armorVisualizerActive) return;
		if (!isPrimaryIntersection(event)) return;
		onclick(getHitInfo(event));
	}

	function stopDeployedAnimationAction() {
		if (!deployedAnimationAction) return;
		deployedAnimationAction.stop();
		deployedAnimationAction = null;
		deployedAnimationRunning = false;
	}

	function resetDeployedAnimationTimer() {
		lastAnimationTime = performance.now();
	}

	function getDeployedAnimationDelta() {
		const now = performance.now();
		const delta = (now - lastAnimationTime) / 1000;
		lastAnimationTime = now;
		return Math.min(delta, 0.1);
	}

	function restoreArmorAndCopyVisualPose() {
		restoreDeployedBasePose(armorRoot, deployedBasePose);
		copyPoseByName();
	}

	function playDeployedClip(clipName: DeployedClipName, loop = false, onFinished?: () => void) {
		if (!deployedAnimationMixer || !deployedAnimationClips) return false;

		const clip = deployedAnimationClips[clipName];
		if (!clip) return false;

		stopDeployedAnimationAction();
		deployedAnimationMixer.stopAllAction();
		if (clipName === 'enter') {
			restoreArmorAndCopyVisualPose();
		}

		const action = deployedAnimationMixer.clipAction(clip);
		action.reset();
		action.enabled = true;
		action.clampWhenFinished = !loop;
		action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
		action.play();
		deployedAnimationAction = action;
		deployedAnimationRunning = true;
		resetDeployedAnimationTimer();
		invalidate();

		if (!loop) {
			const mixer = deployedAnimationMixer;
			const handleFinished = (event: any) => {
				if (event.action !== action) return;
				mixer.removeEventListener('finished', handleFinished);
				if (deployedAnimationAction === action) {
					deployedAnimationAction = null;
					deployedAnimationRunning = false;
				}
				onFinished?.();
				if (clipName === 'exit') {
					restoreArmorAndCopyVisualPose();
				}
			};
			mixer.addEventListener('finished', handleFinished);
		}

		return true;
	}

	function syncDeployedAnimationMode() {
		if (!deployedAnimationMixer || !deployedAnimationClips) return;
		if (lastSyncedDeployedMode === deployedMode) return;

		if (deployedMode) {
			lastSyncedDeployedMode = true;
			if (!playDeployedClip('enter', false, () => playDeployedClip('idle', true))) {
				playDeployedClip('idle', true);
			}
			return;
		}

		const shouldPlayExit = lastSyncedDeployedMode === true;
		lastSyncedDeployedMode = false;
		if (!shouldPlayExit) {
			stopDeployedAnimationAction();
			deployedAnimationMixer.stopAllAction();
			restoreArmorAndCopyVisualPose();
			return;
		}

		if (!playDeployedClip('exit')) {
			stopDeployedAnimationAction();
			deployedAnimationMixer.stopAllAction();
			restoreArmorAndCopyVisualPose();
		}
	}

	$effect(() => {
		const previousAutoRender = autoRender.current;
		autoRender.set(false);

		return () => {
			autoRender.set(previousAutoRender);
			(overlayQuad.geometry as PlaneGeometry).dispose();
			compositeMaterial.dispose();
		};
	});

	useTask(
		() => {
			if (deployedAnimationMixer) {
				deployedAnimationMixer.update(getDeployedAnimationDelta());
				copyPoseByName();
				updateTrackSkinning();
			}

			const activeCamera = camera.current;
			if (!activeCamera) return;

			compositeMaterial.uniforms.texelSize.value.set(
				1 / Math.max(armorFillTarget.width, 1),
				1 / Math.max(armorFillTarget.height, 1)
			);

			const previousAutoClear = renderer.autoClear;
			const previousClearColor = renderer.getClearColor(new Color());
			const previousClearAlpha = renderer.getClearAlpha();

			renderer.autoClear = false;

			if (armorMesh && armorVisualizerActive) {
				const previousMaterial = armorMesh.material;
				armorMesh.visible = true;

				armorMesh.material = armorFillMaterial ?? previousMaterial;
				renderer.setRenderTarget(armorFillTarget);
				renderer.setClearColor(0x000000, 0);
				renderer.clear(true, true, true);
				renderer.render(armorScene, activeCamera);

				armorMesh.material = armorMetaMaterial ?? previousMaterial;
				renderer.setRenderTarget(armorMetaTarget);
				renderer.setClearColor(0x000000, 0);
				renderer.clear(true, true, true);
				renderer.render(armorScene, activeCamera);

				armorMesh.material = previousMaterial;
			}

			renderer.setRenderTarget(null);
			renderer.setClearColor(0x000000, 0);
			renderer.clear(true, true, true);
			renderer.render(scene, activeCamera);

			if (armorMesh && armorVisualizerActive) {
				renderer.clearDepth();
				renderer.render(overlayScene, overlayCamera);
			}

			renderer.setClearColor(previousClearColor, previousClearAlpha);
			renderer.autoClear = previousAutoClear;
		},
		{
			stage: renderStage,
			autoInvalidate: false
		}
	);

	useTask(
		() => {
			// This task exists to keep Threlte invalidating frames while a clip is playing.
		},
		{
			running: () => deployedAnimationRunning,
			autoInvalidate: true
		}
	);

	$effect(() => {
		if (!armorPickMesh) return;

		const interactiveMesh = armorPickMesh;
		addInteractiveObject(interactiveMesh, {
			onpointermove: handlePointerMove,
			onpointerout: handlePointerLeave,
			onpointerleave: handlePointerLeave,
			onpointerdown: handlePointerDown,
			onpointermissed: () => onclick(null)
		});

		return () => {
			removeInteractiveObject(interactiveMesh);
		};
	});

	$effect(() => {
		if (armorFillMaterial) {
			armorFillMaterial.uniforms.shellPen.value = shellPenetration;
		}
		if (armorMetaMaterial) {
			armorMetaMaterial.uniforms.shellPen.value = shellPenetration;
		}
	});

	$effect(() => {
		if (armorMesh) {
			armorMesh.visible = armorVisualizerActive;
		}
		if (!armorVisualizerActive) {
			onhover(null);
		}
		invalidate();
	});

	$effect(() => {
		deployedMode;
		deployedAnimationClips;
		syncDeployedAnimationMode();
	});

	$effect(() => {
		const currentVehicleId = vehicleId;
		let cancelled = false;
		let localArmorRoot: Object3D | null = null;
		let localArmorMesh: ThreeMesh | null = null;
		let localArmorPickMesh: Object3D | null = null;
		let localVisualRoot: Object3D | null = null;
		let localAnimationMixer: AnimationMixer | null = null;
		let localBasePose: DeployedBasePose | null = null;

		onhover(null);
		onclick(null);

		Promise.all([
			loadArmorData(currentVehicleId),
			loadArmorAsset(currentVehicleId),
			loadVisualScene(currentVehicleId),
			loadDeployedAnimationClips(currentVehicleId),
			loadTracksData(currentVehicleId)
		])
			.then(([nextArmorData, armorAsset, visualScene, animationClips, tracksData]) => {
				if (cancelled) {
					disposeObject(armorAsset.root);
					disposeObject(visualScene);
					return;
				}

				const builtArmor = buildArmorMesh(armorAsset.mesh, nextArmorData);
				localArmorRoot = armorAsset.root;
				localArmorMesh = builtArmor.mesh;
				localArmorMesh.visible = armorVisualizerActive;
				localArmorPickMesh = localArmorMesh;
				localVisualRoot =
					visualScene != null
						? prepareVisualScene(visualScene)
						: buildFallbackVisualMesh(localArmorMesh.geometry as BufferGeometry);
				// Tracks load their own GLB(s) asynchronously, then each tread link is
				// skinned to its nearest track/wheel bone so the tracks follow the body —
				// including folding during a deploy animation (rest bones captured below).
				const trackVisualRoot = localVisualRoot;
				let restTrackBones: TrackBoneRest[] = [];
				buildTracks(tracksData).then((tracks) => {
					if (cancelled || !tracks) {
						if (tracks) disposeObject(tracks);
						return;
					}
					trackVisualRoot.add(tracks);
					const parts = bindTrackSkinning(tracks, restTrackBones);
					if (parts) {
						trackSkinParts = parts;
						trackSkinRoot = trackVisualRoot;
						updateTrackSkinning();
					}
					invalidate();
				});
				localBasePose = captureDeployedBasePose(localArmorRoot);
				const normalizedAnimationClips = animationClips
					? {
							enter: normalizeDeployedAnimationClip(animationClips.enter ?? null, localArmorRoot) ?? undefined,
							idle: normalizeDeployedAnimationClip(animationClips.idle ?? null, localArmorRoot) ?? undefined,
							exit: normalizeDeployedAnimationClip(animationClips.exit ?? null, localArmorRoot) ?? undefined
						}
					: null;
				localAnimationMixer = normalizedAnimationClips ? new AnimationMixer(localArmorRoot) : null;

				armorScene.add(localArmorRoot);
				scene.add(localVisualRoot);

				armorRoot = localArmorRoot;
				armorMesh = localArmorMesh;
				armorPickMesh = localArmorPickMesh;
				armorData = nextArmorData;
				armorFillMaterial = builtArmor.fillMaterial;
				armorMetaMaterial = builtArmor.metaMaterial;
				visualRoot = localVisualRoot;
				deployedAnimationClips = normalizedAnimationClips;
				deployedAnimationMixer = localAnimationMixer;
				deployedBasePose = localBasePose;
				copyPoseByName(localArmorRoot, localVisualRoot);
				// Capture the rest-pose track/wheel bones for the async track skinning above.
				restTrackBones = gatherTrackBones(localVisualRoot);
				lastSyncedDeployedMode = null;
				syncDeployedAnimationMode();
				invalidate();
			})
			.catch((error) => {
				console.error('[ArmorViewer] Failed to load viewer assets for', currentVehicleId, error);
			});

		return () => {
			cancelled = true;
			onhover(null);

			if (localArmorRoot) {
				armorScene.remove(localArmorRoot);
				disposeObject(localArmorRoot);
				if (armorMesh === localArmorMesh) {
					armorMesh = null;
					armorData = null;
					armorFillMaterial = null;
					armorMetaMaterial = null;
				}
				if (armorPickMesh === localArmorPickMesh) {
					armorPickMesh = null;
				}
				if (armorRoot === localArmorRoot) {
					armorRoot = null;
				}
			}

			if (localVisualRoot) {
				if (trackSkinRoot === localVisualRoot) {
					trackSkinParts = null;
					trackSkinRoot = null;
				}
				scene.remove(localVisualRoot);
				disposeObject(localVisualRoot);
				if (visualRoot === localVisualRoot) {
					visualRoot = null;
				}
			}

			if (deployedAnimationMixer === localAnimationMixer) {
				stopDeployedAnimationAction();
				deployedAnimationMixer?.stopAllAction();
				if (localArmorRoot) {
					deployedAnimationMixer?.uncacheRoot(localArmorRoot);
				}
				deployedAnimationMixer = null;
				deployedAnimationClips = null;
				deployedBasePose = null;
				lastSyncedDeployedMode = null;
			}
		};
	});
</script>

<T.PerspectiveCamera makeDefault position={[4, 3, 6]} fov={45}>
	<OrbitControls
		enableDamping
		dampingFactor={0.15}
		minDistance={2}
		maxDistance={28}
		enablePan={true}
		target={[0, 1.1, 0]}
	/>
</T.PerspectiveCamera>

<T.AmbientLight intensity={0.7} />
<T.DirectionalLight position={[5, 8, 5]} intensity={0.8} />
<T.DirectionalLight position={[-3, 4, -5]} intensity={0.4} />

<T.GridHelper args={[20, 40, '#2a4a3a', '#1a2e24']} position.y={-0.01} />
