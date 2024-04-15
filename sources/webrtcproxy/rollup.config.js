// rollup.config.js
// rollup will be the module bundler for webrtc connectivity test page replacing browserify used in the buildspec_init. 
//After the fix of randombytes is not a function issue with rollup generated bundle
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from "@rollup/plugin-json";
import nodePolyfills from 'rollup-plugin-polyfill-node';

export default {
  input: './landingpage/index.js',
  // external: [
	// 	'crypto'
	// ],
  output: {
    file: './landingpage/bundle.js',
    format: 'cjs',
    name: 'MyModule'
    // ,globals: {
    //   'crypto' : "require$$0$5" 
    // }
  },
  plugins: [nodeResolve(), commonjs(),json(),
    nodePolyfills(
    [ 'util',
      'stream',
      'path',
      'http',
      'https',
      'url',
      'fs',
      'assert',
      'tty',
      'net',
      'zlib',
      'events'
      ,'crypto'
    ]
    )
  ]
};