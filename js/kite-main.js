// Copyright 2016, University of Colorado Boulder
(function() {
  'use strict';
  if ( !window.hasOwnProperty( '_' ) ) {
    throw new Error( 'Underscore/Lodash not found: _' );
  }
  define( function( require ) {

    window.axon = require( 'AXON/main' );
    window.dot = require( 'DOT/main' );
    window.kite = require( 'KITE/main' );
    window.phetCore = require( 'PHET_CORE/main' );
  } );
})();