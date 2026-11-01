// VLM-верификация Task 25: шлюпка без палочки носом вдоль + корабль режет волны
import ZAI from 'z-ai-web-dev-sdk';
import { readFileSync } from 'node:fs';

async function ask(zai, file, prompt) {
  const b64 = readFileSync(file).toString('base64');
  const response = await zai.chat.completions.createVision({
    model: 'glm-4.6v',
    messages: [
      { role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      ] },
    ],
    thinking: { type: 'disabled' },
  });
  console.log(`\n===== ${file.split('/').pop()} =====`);
  console.log(response.choices?.[0]?.message?.content ?? JSON.stringify(response).slice(0, 400));
}

async function main() {
  const zai = await ZAI.create();

  await ask(zai, '/home/z/my-project/scripts/shots/t25_boat_along.png',
`Кадр морской игры: корма парусника, вид с борта (корабль уходит вглубь кадра). За транцем на кранбалках-шлюпбалках висит гребная шлюпка. Ответь СТРОГО и кратко, только то что ВИДНО:
1) Острый НОС шлюпки направлен В ТУ ЖЕ СТОРОНУ, что и нос большого корабля (вдоль корпуса, к его носу) — да/нет?
2) Сзади/снизу шлюпки торчит какая-либо ПАЛКА/перо руля/перекладина между шлюпбалками? Опиши.
3) Шлюпка висит ровно, не перевёрнута?
4) ВЕРДИКТ: шлюпка без палки сзади, носом вдоль корпуса корабля (да/нет)?`);

  for (const f of ['t25_storm_cut1.png', 't25_storm_cut2.png']) {
    await ask(zai, `/home/z/my-project/scripts/shots/${f}`,
`Кадр морской игры: парусник в шторм на больших волнах. Ответь СТРОГО и кратко, только то что ВИДНО:
1) Море с крупными волнами/гребнями с пеной?
2) Корпус корабля ДИФФЕРЕНТИРОВАН (нос заметно выше или ниже кормы — корабль идёт по склону волны/режет её)?
3) У НОСА видны БРЫЗГИ/пена/водяная пыль (носовой бурун, вода расходится по бортам)?
4) Корабль НЕ уходит целиком под воду и не висит в воздухе?
5) ВЕРДИКТ: корабль реально качает на волнах, режет их носом (да/нет)?`);
  }

  await ask(zai, '/home/z/my-project/scripts/shots/t25_storm_cut3.png',
`Кадр морской игры: парусник в шторм. Ответь кратко:
1) Есть ли момент, когда волна/пена накрывает или захлёстывает палубу/нос корабля?
2) Видны потоки воды или брызги НА палубе/над бортом?
3) ВЕРДИКТ: вода взаимодействует с кораблём (брызги/пена/накаты) (да/нет)?`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
