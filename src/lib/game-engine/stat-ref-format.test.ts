import { describe, expect, it } from 'vitest';
import {
	findStatRefs,
	formatStatNumber,
	normalizeShow,
	normalizeStatKey,
	resolveStatText,
	transformStatRefHtml,
	type VehicleLike
} from './stat-ref-format';

const atlas: VehicleLike = {
	name: 'Atlas',
	classLabel: 'Heavy',
	classId: 'heavy',
	stats: {
		MaxHealth: 1450,
		MaxSpeed: 58,
		ReloadTime: 9.2,
		CamoPercentage: 30
	}
};

describe('formatStatNumber', () => {
	it('groups thousands and trims decimals', () => {
		expect(formatStatNumber(1450)).toBe('1,450');
		expect(formatStatNumber(58)).toBe('58');
		expect(formatStatNumber(9.2)).toBe('9.2');
		expect(formatStatNumber(9.204)).toBe('9.2');
		expect(formatStatNumber(9.246)).toBe('9.25');
	});
});

describe('normalizeStatKey', () => {
	it('maps aliases and raw keys, plus name/class fields', () => {
		expect(normalizeStatKey('health')).toEqual({ kind: 'stat', key: 'MaxHealth' });
		expect(normalizeStatKey('HP')).toEqual({ kind: 'stat', key: 'MaxHealth' });
		expect(normalizeStatKey('MaxSpeed')).toEqual({ kind: 'stat', key: 'MaxSpeed' });
		expect(normalizeStatKey('name')).toEqual({ kind: 'name' });
		expect(normalizeStatKey('class')).toEqual({ kind: 'class' });
		expect(normalizeStatKey('totally-made-up')).toBeNull();
	});
});

describe('normalizeShow', () => {
	it('defaults unknown modes to value', () => {
		expect(normalizeShow(undefined)).toBe('value');
		expect(normalizeShow('label')).toBe('label');
		expect(normalizeShow('nope')).toBe('value');
	});
});

describe('resolveStatText', () => {
	it('renders value with the stat unit', () => {
		expect(resolveStatText(atlas, 'health', 'value')).toEqual({
			ok: true,
			text: '1,450',
			label: 'Health'
		});
		expect(resolveStatText(atlas, 'speed', 'value')).toEqual({
			ok: true,
			text: '58 kph',
			label: 'Top Speed'
		});
		expect(resolveStatText(atlas, 'camo', 'value')).toEqual({
			ok: true,
			text: '30%',
			label: 'Camo'
		});
		expect(resolveStatText(atlas, 'reload', 'value')).toEqual({
			ok: true,
			text: '9.2s',
			label: 'Reload Time'
		});
	});

	it('honours number and label show modes', () => {
		expect(resolveStatText(atlas, 'speed', 'number')).toEqual({
			ok: true,
			text: '58',
			label: 'Top Speed'
		});
		expect(resolveStatText(atlas, 'health', 'label')).toEqual({
			ok: true,
			text: 'Health',
			label: 'Health'
		});
	});

	it('resolves name and class fields', () => {
		expect(resolveStatText(atlas, 'name', 'value')).toEqual({
			ok: true,
			text: 'Atlas',
			label: 'Name'
		});
		expect(resolveStatText(atlas, 'class', 'value')).toEqual({
			ok: true,
			text: 'Heavy',
			label: 'Class'
		});
	});

	it('flags unknown stats and missing values', () => {
		expect(resolveStatText(atlas, 'bogus', 'value')).toEqual({
			ok: false,
			reason: 'unknown-stat'
		});
		// A known stat key the vehicle simply doesn't carry.
		expect(resolveStatText(atlas, 'penetration', 'value')).toEqual({
			ok: false,
			reason: 'missing-value'
		});
	});
});

describe('findStatRefs', () => {
	it('extracts references from rendered HTML', () => {
		const html =
			'<p>x <aggro-stat data-tank="atlas" data-stat="health" data-show="value"></aggro-stat> y ' +
			'<aggro-stat data-tank="blink" data-stat="speed" data-show="number">58</aggro-stat></p>';
		expect(findStatRefs(html)).toEqual([
			{ tank: 'atlas', stat: 'health', show: 'value' },
			{ tank: 'blink', stat: 'speed', show: 'number' }
		]);
	});
});

describe('transformStatRefHtml', () => {
	it('fills empty reference elements with resolved text and a title', () => {
		const html = '<aggro-stat data-tank="atlas" data-stat="health" data-show="value"></aggro-stat>';
		const out = transformStatRefHtml(html, () => ({ text: '1,450', title: 'Atlas · Health' }));
		expect(out).toBe(
			'<aggro-stat data-tank="atlas" data-stat="health" data-show="value" title="Atlas · Health">1,450</aggro-stat>'
		);
	});

	it('is idempotent — re-rendering an already-filled element updates the value', () => {
		const filled =
			'<aggro-stat data-tank="atlas" data-stat="health" data-show="value" title="Atlas · Health">1,400</aggro-stat>';
		const out = transformStatRefHtml(filled, () => ({ text: '1,450', title: 'Atlas · Health' }));
		expect(out).toContain('>1,450</aggro-stat>');
		expect(out).not.toContain('1,400');
	});

	it('falls back to an em dash when a reference cannot be resolved', () => {
		const html = '<aggro-stat data-tank="ghost" data-stat="health" data-show="value"></aggro-stat>';
		const out = transformStatRefHtml(html, () => null);
		expect(out).toContain('>—</aggro-stat>');
	});

	it('escapes resolved text', () => {
		const html = '<aggro-stat data-tank="atlas" data-stat="name" data-show="value"></aggro-stat>';
		const out = transformStatRefHtml(html, () => ({ text: '<b>x</b>' }));
		expect(out).toContain('&lt;b&gt;x&lt;/b&gt;');
		expect(out).not.toContain('<b>x</b>');
	});
});
