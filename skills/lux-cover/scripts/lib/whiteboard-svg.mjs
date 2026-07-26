function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function backgroundSvg(width, height, profile) {
  const { colors, paper } = profile;
  const dots = [];
  for (let y = paper.dot_spacing / 2; y < height; y += paper.dot_spacing) {
    for (let x = paper.dot_spacing / 2; x < width; x += paper.dot_spacing) {
      dots.push(`<circle cx="${x}" cy="${y}" r="${paper.dot_radius}" fill="${xml(colors.paper_fiber)}"/>`);
    }
  }
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="paper-noise" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="17"/>
        <feColorMatrix type="saturate" values="0"/>
        <feComponentTransfer><feFuncA type="table" tableValues="0 0.10"/></feComponentTransfer>
      </filter>
    </defs>
    <rect width="${width}" height="${height}" fill="${xml(colors.paper)}"/>
    <rect width="${width}" height="${height}" fill="${xml(colors.paper_fiber)}" filter="url(#paper-noise)" opacity="0.28"/>
    <g opacity="${paper.fiber_opacity * 0.45}">${dots.join("")}</g>
  </svg>`);
}
