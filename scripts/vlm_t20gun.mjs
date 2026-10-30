// VLM: палубные орудия шлюпа — металл с PBR-нормалями
import ZAI from 'z-ai-web-dev-sdk';
import { readFileSync } from 'node:fs';

async function main() {
  const zai = await ZAI.create();
  const b64 = readFileSync('/home/z/my-project/scripts/shots/v37_gun_metal3.png').toString('base64');
  const response = await zai.chat.completions.createVision({
    model: 'glm-4.6v',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `Кадр морской игры: палуба небольшого парусного корабля, на палубе пушки. Оцени СТРОГО по пунктам, кратко:
1) ПУШКИ: сколько орудий видно? Стоят на палубе на лафетах?
2) СТВОЛЫ: тёмные металлические цилиндры — есть ли на них БЛИКИ/отсветы, неровности поверхности, ощущение металла (не картон)?
3) ДЕТАЛИ: видны дульные срезы, кольца/муфты на стволах, деревянные лафеты с колёсами?
4) ВЕРДИКТ: орудия читаются как деревянно-металлические предметы (да/нет)?` },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      },
    ],
    thinking: { type: 'disabled' },
  });
  console.log(response.choices?.[0]?.message?.content ?? JSON.stringify(response).slice(0, 400));
}

main().catch(e => { console.error('VLM fail:', e?.message || e); process.exit(1); });
