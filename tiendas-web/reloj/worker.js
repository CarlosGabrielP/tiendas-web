// Worker "{{tienda.proyecto}}-tareas" (reloj): Cloudflare Pages no ejecuta tareas programadas, así que este Worker
// le pide a la tienda que haga sus revisiones. No guarda datos: solo necesita el secreto TAREAS_TOKEN,
// el mismo que tiene la tienda (Pages → Settings → Variables and Secrets).
// Programación (UTC): "7 * * * *" = revisión cada hora · "17 9 * * *" = respaldo diario (3:17 a. m. hora de México).
export default {
  async scheduled(evento, env, ctx) {
    if (!env.TAREAS_TOKEN) { console.log("Falta el secreto TAREAS_TOKEN"); return; }
    const tarea = evento.cron === "17 9 * * *" ? "respaldo" : "revisar";
    const sitio = env.SITIO || "{{tienda.sitio}}";
    const r = await fetch(`${sitio}/api/interno/tareas`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-{{tienda.clave}}-tareas": env.TAREAS_TOKEN, "user-agent": "{{tienda.clave}}-reloj/1.0" },
      body: JSON.stringify({ tarea }),
    });
    console.log(tarea, r.status, (await r.text()).slice(0, 300));
  },
  async fetch() { return new Response("No encontrado.", { status: 404 }); },
};
