import { describe, expect, it } from 'vitest';

import { parseContent } from './content';

describe('parseContent', () => {
	it('sanitizes raw HTML and javascript URLs from markdown output', () => {
		const content = parseContent(
			`---
headline: "Test"
---

<script>alert('xss')</script>

[malicious](javascript:alert('xss'))
`
		);

		expect(content.html).not.toContain('<script>');
		expect(content.html).not.toContain('javascript:');
	});
});
