<script lang="ts">
	import { T, useTask, useThrelte } from '@threlte/core';
	import { OrbitControls, interactivity, useFBO, useInteractivity } from '@threlte/extras';
	import type { ArmorHitInfo } from './types';
	import {
		BufferAttribute,
		BufferGeometry,
		Color,
		FrontSide,
		LinearFilter,
		Mesh as ThreeMesh,
		MeshStandardMaterial,
		NearestFilter,
		Object3D,
		OrthographicCamera,
		PlaneGeometry,
		Quaternion,
		Scene,
		ShaderMaterial,
		SkinnedMesh,
		Vector2,
		Vector3,
		type Material
	} from 'three';
	import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
	import type { VehicleDeploySpec, DeployAxis } from '$lib/data/vehicle-deploy-spec';

	type ArmorData = {
		vehicleId: string;
		textureWidth: number;
		textureHeight: number;
		triangles: [number, number][];
		isModule: number[];
		isAbsorb?: number[];
		sectionIds?: number[];
	};

	let {
		vehicleId,
		onhover,
		onclick,
		shellPenetration = 50,
		showArmorVisualizer = true,
		deploySpec = null,
		deployed = false
	}: {
		vehicleId: string;
		onhover: (info: ArmorHitInfo | null) => void;
		onclick: (info: ArmorHitInfo | null) => void;
		shellPenetration?: number;
		showArmorVisualizer?: boolean;
		deploySpec?: VehicleDeploySpec | null;
		deployed?: boolean;
	} = $props();

	interactivity();

	const { scene, renderer, camera, autoRender, renderStage } = useThrelte();
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

	let armorMesh: ThreeMesh | null = $state(null);
	let armorPickMesh: Object3D | null = $state(null);
	let armorData: ArmorData | null = $state(null);
	let armorFillMaterial: ShaderMaterial | null = null;
	let armorMetaMaterial: ShaderMaterial | null = null;
	let visualRoot: Object3D | null = $state(null);

	type DeployBinding = {
		joint: Object3D;
		bindQuat: Quaternion;
		deployedQuat: Quaternion;
	};
	let deployBindings: DeployBinding[] = [];
	let skinnedMeshes: SkinnedMesh[] = [];
	let deployProgress = 0;

	const AUTO_BOUNCE_ANGLE = 80;
	const OVERMATCH_MULTIPLIER = 4.0;
	const HALF_CHANCE_PEN_MULTIPLIER = 1.1;
	const FALLBACK_VISUAL_COLOR = new Color(0x66746d);
	const gltfLoader = new GLTFLoader();

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

		void main() {
			vThickness = armorThickness;
			vIsModule = isModule;
			vIsAbsorb = isAbsorb;
			vIsFiftyFifty = isFiftyFifty;
			vSectionKeyId = sectionKeyId;
			vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
			vec4 worldPos = modelMatrix * vec4(position, 1.0);
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
				if (vIsAbsorb > 0.5) {
					fillColor = vec3(0.35, 0.01, 0.24);
					outlineColor = vec3(1.00, 0.04, 0.68);
				} else {
					fillColor = vec3(0.09, 0.20, 0.75);
					outlineColor = vec3(0.00, 0.23, 1.00);
				}
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

	function cloneFirstMeshGeometry(root: Object3D) {
		let found: BufferGeometry | null = null;

		root.traverse((child) => {
			if (found || !(child as any).isMesh) return;

			const sourceGeometry = (child as any).geometry as BufferGeometry;
			const geometry = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone();
			if (!geometry.getAttribute('normal')) {
				geometry.computeVertexNormals();
			}
			found = geometry;
		});

		return found;
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
		return new Promise<{ geometry: BufferGeometry; pickMesh: Object3D }>((resolve, reject) => {
			gltfLoader.load(
				`/models/vehicles/${currentVehicleId}.glb`,
				(gltf) => {
					const pickMesh = findFirstMesh(gltf.scene) as Object3D | null;
					const geometry = cloneFirstMeshGeometry(gltf.scene);
					if (!pickMesh || !geometry) {
						reject(new Error(`No mesh geometry found for ${currentVehicleId}`));
						return;
					}

					const pickObject = pickMesh as Object3D;
					configurePickMesh(pickObject);
					pickObject.visible = false;
					(pickObject as any).frustumCulled = false;
					pickObject.updateMatrixWorld(true);
					if ((pickObject as any).skeleton?.update) {
						(pickObject as any).skeleton.update();
					}

					resolve({ geometry, pickMesh: pickObject });
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

	function buildArmorMesh(sourceGeometry: BufferGeometry, data: ArmorData) {
		const geometry = sourceGeometry.clone();
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
		const mesh = new ThreeMesh(geometry, fillMaterial);
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

	function axisVector(axis: DeployAxis) {
		if (axis === 'x') return new Vector3(1, 0, 0);
		if (axis === 'y') return new Vector3(0, 1, 0);
		return new Vector3(0, 0, 1);
	}

	function collectSkinnedMeshes(root: Object3D | null) {
		if (!root) return [] as SkinnedMesh[];
		const found: SkinnedMesh[] = [];
		root.traverse((child) => {
			if ((child as SkinnedMesh).isSkinnedMesh) {
				found.push(child as SkinnedMesh);
			}
		});
		return found;
	}

	function findJointByName(root: Object3D | null, name: string): Object3D | null {
		if (!root) return null;
		let match: Object3D | null = null;
		root.traverse((child) => {
			if (match !== null) return;
			if (child.name === name) match = child;
		});
		return match;
	}

	function buildDeployBindings(
		spec: VehicleDeploySpec | null,
		roots: (Object3D | null)[]
	): DeployBinding[] {
		if (!spec) return [];
		const bindings: DeployBinding[] = [];
		for (const config of spec.joints) {
			const angleRad = (config.angleDeg * Math.PI) / 180;
			const delta = new Quaternion().setFromAxisAngle(axisVector(config.axis), angleRad);
			for (const root of roots) {
				const joint = findJointByName(root, config.jointName);
				if (!joint) continue;
				const bindQuat = joint.quaternion.clone();
				const deployedQuat = bindQuat.clone().multiply(delta);
				bindings.push({ joint, bindQuat, deployedQuat });
			}
		}
		return bindings;
	}

	function easeInOut(t: number) {
		return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
	}

	function applyDeployProgress(progress: number) {
		if (!deployBindings.length) return;
		const eased = easeInOut(Math.max(0, Math.min(1, progress)));
		for (const binding of deployBindings) {
			binding.joint.quaternion.slerpQuaternions(binding.bindQuat, binding.deployedQuat, eased);
		}
		for (const mesh of skinnedMeshes) {
			mesh.skeleton.update();
		}
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
		if (!showArmorVisualizer) return;
		if (!isPrimaryIntersection(event)) return;
		onhover(getHitInfo(event));
	}

	function handlePointerLeave() {
		onhover(null);
	}

	function handlePointerDown(event: any) {
		if (!showArmorVisualizer) return;
		if (!isPrimaryIntersection(event)) return;
		onclick(getHitInfo(event));
	}

	$effect(() => {
		const previousAutoRender = autoRender.current;
		autoRender.current = false;

		return () => {
			autoRender.current = previousAutoRender;
			(overlayQuad.geometry as PlaneGeometry).dispose();
			compositeMaterial.dispose();
		};
	});

	useTask((delta) => {
		if (!deployBindings.length) return;
		const target = deployed ? 1 : 0;
		if (deployProgress === target) return;

		const durationSec = Math.max(0.05, (deploySpec?.durationMs ?? 600) / 1000);
		const step = delta / durationSec;
		if (target > deployProgress) {
			deployProgress = Math.min(target, deployProgress + step);
		} else {
			deployProgress = Math.max(target, deployProgress - step);
		}
		applyDeployProgress(deployProgress);
	});

	useTask(
		() => {
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

			if (armorMesh && showArmorVisualizer) {
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

			if (armorMesh && showArmorVisualizer) {
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
			armorMesh.visible = showArmorVisualizer;
		}
		if (!showArmorVisualizer) {
			onhover(null);
		}
	});

	$effect(() => {
		const currentVehicleId = vehicleId;
		let cancelled = false;
		let localArmorMesh: ThreeMesh | null = null;
		let localArmorPickMesh: Object3D | null = null;
		let localVisualRoot: Object3D | null = null;

		onhover(null);
		onclick(null);

		Promise.all([
			loadArmorData(currentVehicleId),
			loadArmorAsset(currentVehicleId),
			loadVisualScene(currentVehicleId)
		])
			.then(([nextArmorData, armorAsset, visualScene]) => {
				if (cancelled) {
					armorAsset.geometry.dispose();
					disposeObject(armorAsset.pickMesh);
					disposeObject(visualScene);
					return;
				}

				const builtArmor = buildArmorMesh(armorAsset.geometry, nextArmorData);
				localArmorMesh = builtArmor.mesh;
				localArmorMesh.visible = showArmorVisualizer;
				localArmorPickMesh = armorAsset.pickMesh;
				localVisualRoot =
					visualScene != null
						? prepareVisualScene(visualScene)
						: buildFallbackVisualMesh(armorAsset.geometry);

				armorScene.add(localArmorMesh);
				scene.add(localArmorPickMesh);
				scene.add(localVisualRoot);

				armorMesh = localArmorMesh;
				armorPickMesh = localArmorPickMesh;
				armorData = nextArmorData;
				armorFillMaterial = builtArmor.fillMaterial;
				armorMetaMaterial = builtArmor.metaMaterial;
				visualRoot = localVisualRoot;

				deployBindings = buildDeployBindings(deploySpec, [
					localVisualRoot,
					localArmorPickMesh
				]);
				skinnedMeshes = [
					...collectSkinnedMeshes(localVisualRoot),
					...collectSkinnedMeshes(localArmorPickMesh)
				];
				deployProgress = deployed ? 1 : 0;
				applyDeployProgress(deployProgress);
			})
			.catch((error) => {
				console.error('[ArmorViewer] Failed to load viewer assets for', currentVehicleId, error);
			});

		return () => {
			cancelled = true;
			onhover(null);
			deployBindings = [];
			skinnedMeshes = [];

			if (localArmorMesh) {
				armorScene.remove(localArmorMesh);
				disposeArmorMesh(localArmorMesh);
				if (armorMesh === localArmorMesh) {
					armorMesh = null;
					armorData = null;
					armorFillMaterial = null;
					armorMetaMaterial = null;
				}
			}

			if (localArmorPickMesh) {
				scene.remove(localArmorPickMesh);
				disposeObject(localArmorPickMesh);
				if (armorPickMesh === localArmorPickMesh) {
					armorPickMesh = null;
				}
			}

			if (localVisualRoot) {
				scene.remove(localVisualRoot);
				disposeObject(localVisualRoot);
				if (visualRoot === localVisualRoot) {
					visualRoot = null;
				}
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
