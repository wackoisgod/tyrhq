import { deflateSync, inflateSync } from 'node:zlib';

import { getGameDataBundle } from '$lib/data/game-data';
import {
	createPlannerCatalog,
	getPlannerTalentsForVehicle,
	type PlannerSelection
} from '$lib/game-engine/build';

const SHARE_CODE_PREFIX = 'TYR';
const SHARE_CODE_VERSION = 1;

const catalog = createPlannerCatalog(getGameDataBundle());

type SharedTechTreeAllocation = {
	talentTag: string;
	pointsAllocated: number;
};

export type SharedTechTreeBlob = {
	vehicleTag: string;
	name: string;
	version: number;
	allocations: SharedTechTreeAllocation[];
};

export type SharedVehicleLoadout = {
	vehicleTag: string;
	components: string[];
	ammoSlots: string[];
	index: number;
	name: string;
	techTree: SharedTechTreeBlob;
};

class BufferWriter {
	private chunks: Buffer[] = [];

	writeInt32(value: number) {
		const chunk = Buffer.allocUnsafe(4);
		chunk.writeInt32LE(value, 0);
		this.chunks.push(chunk);
	}

	writeString(value: string) {
		const chunk = Buffer.from(value, 'utf8');
		this.writeInt32(chunk.length);
		if (chunk.length > 0) {
			this.chunks.push(chunk);
		}
	}

	toBuffer() {
		return Buffer.concat(this.chunks);
	}
}

class BufferReader {
	private offset = 0;

	constructor(private readonly buffer: Buffer) {}

	readInt32() {
		if (this.offset + 4 > this.buffer.length) {
			throw new Error('Unexpected end of buffer while reading int32');
		}

		const value = this.buffer.readInt32LE(this.offset);
		this.offset += 4;
		return value;
	}

	readString() {
		const byteLength = this.readInt32();
		if (byteLength < 0) {
			throw new Error('Negative string length in loadout share payload');
		}
		if (this.offset + byteLength > this.buffer.length) {
			throw new Error('Unexpected end of buffer while reading string');
		}

		const value = this.buffer.subarray(this.offset, this.offset + byteLength).toString('utf8');
		this.offset += byteLength;
		return value;
	}
}

function writeGameplayTagArray(writer: BufferWriter, tags: string[]) {
	writer.writeInt32(tags.length);
	for (const tag of tags) {
		writer.writeString(tag);
	}
}

function writeTechTreeAllocations(writer: BufferWriter, allocations: SharedTechTreeAllocation[]) {
	writer.writeInt32(allocations.length);
	for (const allocation of allocations) {
		writer.writeString(allocation.talentTag);
		writer.writeInt32(allocation.pointsAllocated);
	}
}

function writeTechTreeBlob(writer: BufferWriter, techTree: SharedTechTreeBlob) {
	writer.writeString(techTree.vehicleTag);
	writer.writeString(techTree.name);
	writer.writeInt32(techTree.version);
	writeTechTreeAllocations(writer, techTree.allocations);
}

function writeLoadoutBinary(loadout: SharedVehicleLoadout) {
	const writer = new BufferWriter();
	writer.writeString(loadout.vehicleTag);
	writeGameplayTagArray(writer, loadout.components);
	writeGameplayTagArray(writer, loadout.ammoSlots);
	writer.writeInt32(loadout.index);
	writer.writeString(loadout.name);
	writeTechTreeBlob(writer, loadout.techTree);
	return writer.toBuffer();
}

function readGameplayTagArray(reader: BufferReader) {
	const count = reader.readInt32();
	if (count < 0) {
		throw new Error('Negative gameplay tag array length in loadout share payload');
	}

	return Array.from({ length: count }, () => reader.readString());
}

function readTechTreeAllocations(reader: BufferReader) {
	const count = reader.readInt32();
	if (count < 0) {
		throw new Error('Negative tech tree allocation count in loadout share payload');
	}

	return Array.from({ length: count }, () => ({
		talentTag: reader.readString(),
		pointsAllocated: reader.readInt32()
	}));
}

function readTechTreeBlob(reader: BufferReader): SharedTechTreeBlob {
	return {
		vehicleTag: reader.readString(),
		name: reader.readString(),
		version: reader.readInt32(),
		allocations: readTechTreeAllocations(reader)
	};
}

function readLoadoutBinary(buffer: Buffer): SharedVehicleLoadout {
	const reader = new BufferReader(buffer);
	return {
		vehicleTag: reader.readString(),
		components: readGameplayTagArray(reader),
		ammoSlots: readGameplayTagArray(reader),
		index: reader.readInt32(),
		name: reader.readString(),
		techTree: readTechTreeBlob(reader)
	};
}

function compressLoadoutData(uncompressed: Buffer) {
	const compressed = deflateSync(uncompressed);
	const output = Buffer.allocUnsafe(4 + compressed.length);
	output.writeInt32LE(uncompressed.length, 0);
	compressed.copy(output, 4);
	return output;
}

function decompressLoadoutData(compressed: Buffer) {
	if (compressed.length < 5) {
		throw new Error('Compressed share payload is too small');
	}

	const expectedSize = compressed.readInt32LE(0);
	if (expectedSize <= 0 || expectedSize > 1024 * 1024) {
		throw new Error(`Invalid uncompressed size in share payload: ${expectedSize}`);
	}

	const uncompressed = inflateSync(compressed.subarray(4));
	if (uncompressed.length !== expectedSize) {
		throw new Error(
			`Unexpected uncompressed size in share payload: expected ${expectedSize}, got ${uncompressed.length}`
		);
	}

	return uncompressed;
}

function toBase64Url(buffer: Buffer) {
	return buffer
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '');
}

function fromBase64Url(encoded: string) {
	const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
	return Buffer.from(padded, 'base64');
}

function getExportedBuildName(vehicleName: string, title?: string) {
	return title?.trim() || `${vehicleName} Build`;
}

export function createSharedVehicleLoadout(selection: PlannerSelection, title?: string): SharedVehicleLoadout {
	const vehicle = catalog.vehicleById.get(selection.vehicleId);
	if (!vehicle) {
		throw new Error(`Unknown vehicle "${selection.vehicleId}"`);
	}

	const talentTree = catalog.talentTreeById.get(selection.vehicleId);
	if (!talentTree) {
		throw new Error(`No talent tree found for "${selection.vehicleId}"`);
	}

	const loadoutName = getExportedBuildName(vehicle.name, title);
	const allocations = getPlannerTalentsForVehicle(catalog, selection.vehicleId)
		.flatMap((node) => {
			const points = selection.talentPoints[node.talent.id] ?? 0;
			return points > 0
				? [{ talentTag: node.talent.key, pointsAllocated: points }]
				: [];
		});

	return {
		vehicleTag: vehicle.key,
		components: selection.componentIds.map((componentId) => {
			if (!componentId) return '';
			const component = catalog.componentById.get(componentId);
			if (!component) {
				throw new Error(`Unknown component "${componentId}"`);
			}
			return component.key;
		}),
		ammoSlots: selection.ammoIds.map((ammoId) => {
			const ammo = catalog.ammoById.get(ammoId);
			if (!ammo) {
				throw new Error(`Unknown ammo "${ammoId}"`);
			}
			return ammo.key;
		}),
		index: 0,
		name: loadoutName,
		techTree: {
			vehicleTag: vehicle.key,
			name: loadoutName,
			version: talentTree.version,
			allocations
		}
	};
}

export function exportPlannerSelectionToShareCode(selection: PlannerSelection, title?: string) {
	const loadout = createSharedVehicleLoadout(selection, title);
	const uncompressed = writeLoadoutBinary(loadout);
	const compressed = compressLoadoutData(uncompressed);
	const encoded = toBase64Url(compressed);
	return `${SHARE_CODE_PREFIX}${String(SHARE_CODE_VERSION).padStart(2, '0')}_${encoded}`;
}

export function decodeLoadoutShareCode(shareCode: string): SharedVehicleLoadout {
	if (!shareCode.startsWith(`${SHARE_CODE_PREFIX}`) || shareCode.length < 7) {
		throw new Error('Invalid share code format');
	}

	const versionText = shareCode.slice(SHARE_CODE_PREFIX.length, SHARE_CODE_PREFIX.length + 2);
	if (!/^\d{2}$/.test(versionText) || shareCode[SHARE_CODE_PREFIX.length + 2] !== '_') {
		throw new Error('Invalid share code format');
	}

	const encoded = shareCode.slice(SHARE_CODE_PREFIX.length + 3);
	const compressed = fromBase64Url(encoded);
	const uncompressed = decompressLoadoutData(compressed);
	return readLoadoutBinary(uncompressed);
}
