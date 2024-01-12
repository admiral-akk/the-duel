uniform sampler2D tDiffuse;
uniform float uMinY;
uniform float uWidthY;
uniform float uMaxX;

varying vec2 vUv;

void main()
{
	vec4 texel = texture2D( tDiffuse, vUv );
   float yDist = distance(vUv.y, 0.5);
   float alpha = float(yDist >= uMinY);
   float isLoading = alpha * float(vUv.x <= uMaxX && yDist <= uMinY + uWidthY);
   gl_FragColor = vec4(isLoading,isLoading, isLoading, alpha) + (1. - alpha) * texel;
}