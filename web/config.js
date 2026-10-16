// Configuración para desarrollo local.
// En Docker este archivo se genera al arrancar el contenedor a partir de las
// variables de entorno (ver docker/entrypoint/40-app-config.sh y .env.*.example).
window.APP_CONFIG = {
  appEnv: 'dev',
};
