
if ( window.has ) {
  window.has.add( 'assert.kite', function( global, document, anElement ) {
    return false;
  } );
  window.has.add( 'assert.kite.extra', function( global, document, anElement ) {
    return false;
  } );
}

window.loadedKiteConfig = true;

require.config( {
  deps: [ 'main', 'DOT/main' ],

  paths: {
    underscore: '../contrib/lodash.min-1.0.0-rc.3',
    KITE: '.',
    DOT: '../common/dot/js',
    ASSERT: '../common/assert/js'
  },
  
  shim: {
    underscore: { exports: '_' }
  },

  urlArgs: new Date().getTime() // add cache buster query string to make browser refresh actually reload everything
} );