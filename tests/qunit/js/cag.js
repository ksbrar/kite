// Copyright 2016, University of Colorado Boulder

(function() {
  'use strict';

  module( 'Kite: Constructive Area Geometry' );

  var Shape = kite.Shape;

  function dataToCanvas( snapshot ) {

    var canvas = document.createElement( 'canvas' );
    canvas.width = snapshot.width;
    canvas.height = snapshot.height;
    var context = canvas.getContext( '2d' );
    context.putImageData( snapshot, 0, 0 );
    $( canvas ).css( 'border', '1px solid black' );
    return canvas;
  }

  // compares two pixel snapshots {ImageData} and uses the qunit's assert to verify they are the same
  function dataEquals( a, b, threshold, message, extraDom ) {

    var isEqual = a.width === b.width && a.height === b.height;
    var largestDifference = 0;
    var totalDifference = 0;
    var colorDiffData = document.createElement( 'canvas' ).getContext( '2d' ).createImageData( a.width, a.height );
    var alphaDiffData = document.createElement( 'canvas' ).getContext( '2d' ).createImageData( a.width, a.height );
    if ( isEqual ) {
      for ( var i = 0; i < a.data.length; i++ ) {
        var diff = Math.abs( a.data[ i ] - b.data[ i ] );
        if ( i % 4 === 3 ) {
          colorDiffData.data[ i ] = 255;
          alphaDiffData.data[ i ] = 255;
          alphaDiffData.data[ i - 3 ] = diff; // red
          alphaDiffData.data[ i - 2 ] = diff; // green
          alphaDiffData.data[ i - 1 ] = diff; // blue
        }
        else {
          colorDiffData.data[ i ] = diff;
        }
        var alphaIndex = ( i - ( i % 4 ) + 3 );
        // grab the associated alpha channel and multiply it times the diff
        var alphaMultipliedDiff = ( i % 4 === 3 ) ? diff : diff * ( a.data[ alphaIndex ] / 255 ) * ( b.data[ alphaIndex ] / 255 );

        totalDifference += alphaMultipliedDiff;
        // if ( alphaMultipliedDiff > threshold ) {
          // console.log( message + ': ' + Math.abs( a.data[i] - b.data[i] ) );
        largestDifference = Math.max( largestDifference, alphaMultipliedDiff );
          // isEqual = false;
          // break;
        // }
      }
    }
    var averageDifference = totalDifference / ( 4 * a.width * a.height );
    if ( averageDifference > threshold ) {
      var display = $( '#display' );
      // header
      var note = document.createElement( 'h2' );
      $( note ).text( message );
      display.append( note );
      var differenceDiv = document.createElement( 'div' );
      $( differenceDiv ).text( '(actual) (expected) (color diff) (alpha diff) Diffs max: ' + largestDifference + ', average: ' + averageDifference );
      display.append( differenceDiv );

      display.append( dataToCanvas( a ) );
      display.append( dataToCanvas( b ) );
      display.append( dataToCanvas( colorDiffData ) );
      display.append( dataToCanvas( alphaDiffData ) );

      if ( extraDom ) {
        display.append( extraDom );
      }

      // for a line-break
      display.append( document.createElement( 'div' ) );

      isEqual = false;
    }
    ok( isEqual, message );
    return isEqual;
  }

  function testUnion( aShape, bShape, threshold, message ) {
    var normalCanvas = document.createElement( 'canvas' );
    normalCanvas.width = 100;
    normalCanvas.height = 100;
    var normalContext = normalCanvas.getContext( '2d' );
    normalContext.fillStyle = 'black';

    normalContext.beginPath();
    aShape.writeToContext( normalContext );
    normalContext.fill();

    normalContext.beginPath();
    bShape.writeToContext( normalContext );
    normalContext.fill();

    // document.body.appendChild( normalCanvas );

    var shape = aShape.shapeUnion( bShape );

    var testCanvas = document.createElement( 'canvas' );
    testCanvas.width = 100;
    testCanvas.height = 100;
    var testContext = testCanvas.getContext( '2d' );
    testContext.fillStyle = 'black';

    testContext.beginPath();
    shape.writeToContext( testContext );
    testContext.fill();

    // document.body.appendChild( testCanvas );

    var normalData = normalContext.getImageData( 0, 0, 100, 100 );
    var testData = testContext.getImageData( 0, 0, 100, 100 );

    dataEquals( normalData, testData, threshold, message );
  }

  function testDifference( aShape, bShape, threshold, message ) {
    var normalCanvas = document.createElement( 'canvas' );
    normalCanvas.width = 100;
    normalCanvas.height = 100;
    var normalContext = normalCanvas.getContext( '2d' );
    normalContext.fillStyle = 'white';
    normalContext.fillRect( 0, 0, 100, 100 );
    normalContext.fillStyle = 'black';

    normalContext.beginPath();
    aShape.writeToContext( normalContext );
    normalContext.fill();

    normalContext.fillStyle = 'white';

    normalContext.beginPath();
    bShape.writeToContext( normalContext );
    normalContext.fill();

    // document.body.appendChild( normalCanvas );

    var shape = aShape.shapeDifference( bShape );

    var testCanvas = document.createElement( 'canvas' );
    testCanvas.width = 100;
    testCanvas.height = 100;
    var testContext = testCanvas.getContext( '2d' );
    testContext.fillStyle = 'white';
    testContext.fillRect( 0, 0, 100, 100 );
    testContext.fillStyle = 'black';

    testContext.beginPath();
    shape.writeToContext( testContext );
    testContext.fill();

    // document.body.appendChild( testCanvas );

    var normalData = normalContext.getImageData( 0, 0, 100, 100 );
    var testData = testContext.getImageData( 0, 0, 100, 100 );

    dataEquals( normalData, testData, threshold, message );
  }

  test( 'Triangle union', function() {
    testUnion(
      new Shape().moveTo( 10, 10 ).lineTo( 90, 10 ).lineTo( 50, 90 ).close(),
      new Shape().moveTo( 10, 90 ).lineTo( 90, 90 ).lineTo( 50, 10 ).close(),
      1, 'Union of opposite orientation triangles'
    );
  } );

  test( 'CAG union #1', function() {
    testUnion(
      new Shape().moveTo( 0, 0 ).lineTo( 10, 10 ).lineTo( 20, 0 ).close()
        .moveTo( 4, 2 ).lineTo( 16, 2 ).lineTo( 10, 6 ).close(),
      new Shape()
        .moveTo( 0, 8 ).lineTo( 10, 18 ).lineTo( 20, 8 ).close()
        .moveTo( 0, 20 ).lineTo( 20, 25 ).lineTo( 20, 20 ).lineTo( 0, 25 ).close()
        .moveTo( 0, 25 ).lineTo( 20, 30 ).lineTo( 20, 25 ).lineTo( 0, 30 ).close(),
      1, 'CAG test #1'
    );
  } );

  test( 'CAG union #2', function() {
    testUnion(
      new Shape().moveTo( 0, 0 ).lineTo( 10, 0 ).lineTo( 10, 10 ).lineTo( 0, 10 ).close()
        .moveTo( 5, 10 ).lineTo( 15, 10 ).lineTo( 15, 20 ).lineTo( 5, 20 ).close(),
      new Shape().moveTo( 10, 0 ).lineTo( 20, 0 ).lineTo( 20, 10 ).lineTo( 10, 10 ).close()
        .moveTo( 20, 0 ).lineTo( 20, 10 ).lineTo( 30, 10 ).lineTo( 30, 0 ).close(),
      1, 'CAG test #2'
    );
  } );

  test( 'Difference test', function() {
    testDifference(
      new Shape().rect( 0, 0, 100, 10 ).rect( 0, 20, 100, 10 ).rect( 0, 40, 100, 10 ).rect( 0, 60, 100, 10 ).rect( 0, 80, 100, 10 ),
      new Shape().rect( 0, 0, 10, 100 ).rect( 20, 0, 10, 100 ).rect( 40, 0, 10, 100 ).rect( 60, 0, 10, 100 ).rect( 80, 0, 10, 100 ),
      1, 'Difference test'
    );
  } );

  test( 'CAG multiple test', function() {
    var a = new kite.Shape();
    var b = new kite.Shape();
    var c = new kite.Shape();

    a.moveTo( 0, 2 ).cubicCurveTo( 22, 2, -1, 10, 25, 10 ).lineTo( 25, 16.5 ).lineTo( 0, 16.5 ).close();
    a.moveTo( 0, 10 ).lineTo( 10, 10 ).lineTo( 10, 25 ).lineTo( 0, 25 ).close();
    a.moveTo( 13, 25 ).arc( 10, 25, 3, 0, Math.PI * 1.3, false ).close();

    b.moveTo( 0, 0 ).lineTo( 30, 16.5 ).lineTo( 30, 0 ).close();
    b.moveTo( 15, 2 ).lineTo( 25, 2 ).lineTo( 25, 7 ).quadraticCurveTo( 15, 7, 15, 2 ).close();

    c.rect( 20, 0, 3, 20 );

    a = a.transformed( dot.Matrix3.scaling( 3 ) );
    b = b.transformed( dot.Matrix3.scaling( 3 ) );
    c = c.transformed( dot.Matrix3.scaling( 3 ) );

    testUnion( a, b, 1, 'CAG multiple #1' );

    var ab = a.shapeUnion( b );

    testDifference( ab, c, 1, 'CAG multiple #2' );
  } );

  test( 'Testing cubic overlap', function() {
    var a = new kite.Shape();
    var b = new kite.Shape();

    var curve = new kite.Cubic( dot.v2( 0, 0 ), dot.v2( 10, 0 ), dot.v2( 10, 10 ), dot.v2( 20, 10 ) );

    var left = curve.subdivided( 0.7 )[ 0 ];
    var right = curve.subdivided( 0.3 )[ 1 ];

    a.moveTo( 0, 10 ).lineTo( left.start.x, left.start.y ).cubicCurveTo( left.control1.x, left.control1.y, left.control2.x, left.control2.y, left.end.x, left.end.y ).close();
    b.moveTo( 20, 0 ).lineTo( right.start.x, right.start.y ).cubicCurveTo( right.control1.x, right.control1.y, right.control2.x, right.control2.y, right.end.x, right.end.y ).close();

    testUnion( a, b, 1, 'Cubic overlap union' );
  } );

  test( 'Testing quadratic overlap', function() {
    var a = new kite.Shape();
    var b = new kite.Shape();

    var curve = new kite.Quadratic( dot.v2( 0, 0 ), dot.v2( 10, 0 ), dot.v2( 10, 10 ) );

    var left = curve.subdivided( 0.7 )[ 0 ];
    var right = curve.subdivided( 0.3 )[ 1 ];

    a.moveTo( 0, 10 ).lineTo( left.start.x, left.start.y ).quadraticCurveTo( left.control.x, left.control.y, left.end.x, left.end.y ).close();
    b.moveTo( 20, 0 ).lineTo( right.start.x, right.start.y ).quadraticCurveTo( right.control.x, right.control.y, right.end.x, right.end.y ).close();

    testUnion( a, b, 1, 'Quadratic overlap union' );
  } );
})();