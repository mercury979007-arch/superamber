import { describe, expect, it } from 'vitest';
import { parseTemplateApiResponse } from './CampReportApp';

describe('parseTemplateApiResponse', () => {
  it('accepts valid JSON template responses and normalizes templates', async () => {
    const response = new Response(JSON.stringify({
      status: 'success',
      templates: {
        'L2__Camp 1__1': {
          id: 't1',
          majorCamp: 'L2',
          minorCamp: 'Camp 1',
          dayIndex: 1,
          goalText: 'goal',
          prepText: 'prep',
          backgroundImage: '',
          updatedAt: 1,
        },
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const payload = await parseTemplateApiResponse(response);
    expect(payload.templates['L2__Camp 1__1']?.goalText).toBe('goal');
  });

  it('rejects html fallback responses so local cache is not overwritten by an empty payload', async () => {
    const response = new Response('<!doctype html><html><body>fallback</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

    await expect(parseTemplateApiResponse(response)).rejects.toThrow('模板接口返回格式无效');
  });
});
