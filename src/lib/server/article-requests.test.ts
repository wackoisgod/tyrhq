import { describe, expect, it } from 'vitest';

import { validateToggleArticleStarBody } from './article-requests';

describe('validateToggleArticleStarBody', () => {
	it('accepts a valid article uuid', () => {
		const result = validateToggleArticleStarBody({
			articleId: 'b16e8d6a-fd9d-4ca1-8936-13ef51eaef37'
		});

		expect(result.success).toBe(true);
	});

	it('rejects an invalid article id', () => {
		const result = validateToggleArticleStarBody({
			articleId: 'not-a-uuid'
		});

		expect(result.success).toBe(false);
	});
});
