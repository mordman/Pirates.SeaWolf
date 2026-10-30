import ZAI from 'z-ai-web-dev-sdk';
import { readFileSync } from 'node:fs';
async function main() {
  const zai = await ZAI.create();
  const b64 = readFileSync('/home/z/my-project/scripts/shots/v37_gun_metal5.png').toString('base64');
  const r = await zai.chat.completions.createVision({
    model: 'glm-4.6v',
    messages: [{ role: 'user', content: [
      { type: 'text', text: `Кадр морской игры: борт парусного корабля (фрегат) с двумя рядами пушечных портов, из портов торчат стволы орудий. Оцени СТРОГО по пунктам, кратко:
1) СТВОЛЫ: видны ли стволы, торчащие из портов? Сколько примерно?
2) БЛИКИ: у стволов есть градиент яркости/светлые грани (отражение неба), или они однотонно-плоские?
3) ОБШИВКА: борт с рельефом досок (пояса, тени швов) или гладкий?
4) ВЕРДИКТ: орудия и борт выглядят материальными (металл/дерево), а не картон (да/нет)?` },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
    ]}],
    thinking: { type: 'disabled' },
  });
  console.log(r.choices?.[0]?.message?.content ?? JSON.stringify(r).slice(0, 400));
}
main().catch(e => { console.error('VLM fail:', e?.message || e); process.exit(1); });
