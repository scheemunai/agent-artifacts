import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors.js';
import { mergeTemplateContent } from '../../src/services/templates.js';

const slots = [
  { name: 'title', description: 'Title', required: true },
  { name: 'body', description: 'Body', required: true },
  { name: 'aside', description: 'Optional aside', required: false },
];

describe('template merge engine', () => {
  it('merges slots in a single pass without re-scanning substituted values', () => {
    const content = mergeTemplateContent({
      content: '# {{title}}\n\n{{body}}',
      slots,
      values: {
        title: 'Single pass',
        body: 'This stays literal: {{title}} and {{aside}}.',
      },
    });

    expect(content).toBe('# Single pass\n\nThis stays literal: {{title}} and {{aside}}.');
  });

  it('unescapes literal braces only in template text segments', () => {
    const content = mergeTemplateContent({
      content: 'Template literal: \\{\\{. Value: {{body}}',
      slots,
      values: { title: 'Unused', body: 'keep escapes \\{\\{ and token {{title}} literal' },
    });

    expect(content).toBe(
      'Template literal: {{. Value: keep escapes \\{\\{ and token {{title}} literal'
    );
  });

  it('reports missing and unknown slot details with valid slots', () => {
    expect(() =>
      mergeTemplateContent({
        content: '{{title}} {{body}}',
        slots,
        values: { title: 'Only title', surprise: 'nope' },
      })
    ).toThrow(AppError);

    try {
      mergeTemplateContent({
        content: '{{title}} {{body}}',
        slots,
        values: { title: 'Only title', surprise: 'nope' },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(400);
      expect((error as AppError).code).toBe('validation_failed');
      expect((error as AppError).details).toEqual({
        missing_slots: ['body'],
        unknown_slots: ['surprise'],
        valid_slots: ['title', 'body', 'aside'],
      });
    }
  });

  it('merges absent optional slots as empty strings', () => {
    const content = mergeTemplateContent({
      content: '{{title}}|{{aside}}|{{body}}',
      slots,
      values: { title: 'T', body: 'B' },
    });

    expect(content).toBe('T||B');
  });

  it('leaves no template-token residue after a complete merge and rejects invalid markers', () => {
    const content = mergeTemplateContent({
      content: '{{title}}\n{{body}}\n{{aside}}',
      slots,
      values: { title: 'T', body: 'B', aside: 'A' },
    });

    expect(content).not.toMatch(/\{\{[a-z0-9_]+\}\}/);
    expect(() =>
      mergeTemplateContent({
        content: 'Invalid {{bad-slot}} marker',
        slots,
        values: { title: 'T', body: 'B' },
      })
    ).toThrow(AppError);
  });
});
