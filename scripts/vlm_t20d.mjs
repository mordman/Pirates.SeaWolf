import ZAI from 'z-ai-web-dev-sdk';
import { readFileSync } from 'node:fs';
async function main() {
  const zai = await ZAI.create();
  for (const [file, q] of [
    ['/home/z/my-project/scripts/shots/v37_hull_pbr2.png',
`Кадр морской игры: борт парусного корабля (фрегат) сбоку. Кратко:
1) ОБШИВКА: рельеф досок/поясов с тенями швов виден? 
2) ЗАЛИВКА: борт не «пересвечен» бликами (не выглядит хромом/пластиком)?
3) ОБЩЕЕ: выглядит как крашеное деревянное судно (да/нет)?`],
    ['/home/z/my-project/scripts/shots/v37_galley_reverse.png',
`Кадр морской игры: галера с борта. Кратко:
1) ВЁСЛА вывалены за оба борта?
2) ВЁСЛА в одинаковой фазе гребка (гребут синхронно)?
3) ВЕРДИКТ: галера на ходу под вёслами (да/нет)?`],
  ]) {
    const b64 = readFileSync(file).toString('base64');
    const r = await zai.chat.completions.createVision({
      model: 'glm-4.6v',
      messages: [{ role: 'user', content: [
        { type: 'text', text: q },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      ]}],
      thinking: { type: 'disabled' },
    });
    console.log(`\n===== ${file.split('/').pop()} =====`);
    console.log(r.choices?.[0]?.message?.content ?? JSON.stringify(r).slice(0, 300));
  }
}
main().catch(e => { console.error('VLM fail:', e?.message || e); process.exit(1); });
