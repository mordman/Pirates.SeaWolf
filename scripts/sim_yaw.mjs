// Эталонная симуляция рыскания: только руль + инерция + демпфер
const dt = 1 / 60;
const m = 150_000;
const L = 28, B = 7.4;
const Iy = m * (L * L + B * B) / 12 * 1.2;
let rudder = 0;
const rudderTarget = 1;
let omega = 0;
const spd = 5.5; // м/с (10.7 узла)

for (let i = 0; i < 60 * 8; i++) {
  rudder += (rudderTarget - rudder) * Math.min(1, dt * 1.8);
  const rudderAngle = rudder * 0.6;
  const yawAuth = Math.min(1.15, Math.max(0, spd / 4));
  const torqueY = rudderAngle * yawAuth * m * 7.0;
  omega *= Math.exp(-0.9 * dt);
  omega += (torqueY / Iy) * dt;
  if (i % 120 === 0) {
    console.log(`t=${(i / 60).toFixed(0)}s rudder=${rudder.toFixed(2)} omega=${omega.toFixed(4)} rad/s = ${(omega * 57.3).toFixed(2)} deg/s`);
  }
}
console.log(`Iy=${Iy}  установившийся omega=${(0.6 * 1.15 * 7 / 83.9 / 0.9).toFixed(4)} rad/s`);
