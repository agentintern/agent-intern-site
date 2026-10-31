// Asks whether a real graphics chip can run the 3D. It's a worker because creating a WebGL context with no chip can
// block for over a second, and that mustn't happen on the page's own thread.
const context = new OffscreenCanvas(1, 1).getContext('webgl2');
let usable = false;
if (context) {
  const info = context.getExtension('WEBGL_debug_renderer_info');
  const renderer = info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  usable = !/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
  context.getExtension('WEBGL_lose_context')?.loseContext();
}
postMessage(usable);
