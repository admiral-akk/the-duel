uniform sampler2D uMatcap;
varying vec3 vNormal;

// Variables described here: https://www.khronos.org/opengl/wiki/Built-in_Variable_(GLSL)
void main()
{
   vec2 uv = 0.5 * vNormal.xy + vec2(0.5,0.5);
   vec4 matcapColor = texture2D(uMatcap, uv);
   gl_FragColor = vec4(matcapColor.rgb, 1.0);
}