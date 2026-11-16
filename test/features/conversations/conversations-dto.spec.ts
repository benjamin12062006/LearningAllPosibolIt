import { describe, expect, it } from '@jest/globals';
import { validateAs } from '../../../src/common/http/validation-options.js';
import {
  AppendConversationMessageDto,
  CreateConversationDto,
} from '../../../src/conversations/conversations.dto.js';

const CLIENT_ID = '9f219ba5-153b-4df3-a750-2dca55a00e07';

describe('DTO de conversaciones', () => {
  it('valida texto en los límites y conserva Unicode y tabulaciones interiores', async () => {
    const title = '🪴'.repeat(200);
    await expect(
      validateAs(CreateConversationDto, { title: ` ${title} ` }),
    ).resolves.toEqual({ title });

    const content = 'Primera línea\nsegunda línea\tárbol';
    await expect(
      validateAs(AppendConversationMessageDto, {
        clientMessageId: CLIENT_ID.toUpperCase(),
        content: ' Primera línea\rsegunda línea\tárbol ',
      }),
    ).resolves.toEqual({ clientMessageId: CLIENT_ID, content });

    const atLimit = 'x'.repeat(16_000);
    await expect(
      validateAs(AppendConversationMessageDto, {
        clientMessageId: CLIENT_ID,
        content: atLimit,
      }),
    ).resolves.toMatchObject({ content: atLimit });
  });

  it('rechaza caracteres de control y unidades Unicode sin pareja antes de guardar', async () => {
    for (const invalid of ['A\u0000B', 'A\u007fB', 'A\u0085B', 'A\ud800B']) {
      await expect(
        validateAs(CreateConversationDto, { title: invalid }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        validateAs(AppendConversationMessageDto, {
          clientMessageId: CLIENT_ID,
          content: invalid,
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it('cuenta los selectores de variación como PostgreSQL para los límites de texto', async () => {
    const heartWithVariationSelector = '\u2764\ufe0f';
    const title = heartWithVariationSelector.repeat(100);
    await expect(validateAs(CreateConversationDto, { title })).resolves.toEqual(
      { title },
    );
    await expect(
      validateAs(CreateConversationDto, { title: `${title}a` }),
    ).rejects.toMatchObject({ status: 400 });

    const content = heartWithVariationSelector.repeat(8_000);
    await expect(
      validateAs(AppendConversationMessageDto, {
        clientMessageId: CLIENT_ID,
        content,
      }),
    ).resolves.toMatchObject({ content });
    await expect(
      validateAs(AppendConversationMessageDto, {
        clientMessageId: CLIENT_ID,
        content: `${content}a`,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
