// Copyright 2002-2013, University of Colorado Boulder

/**
 * Linear segment
 *
 * @author Jonathan Olson <jonathan.olson@colorado.edu>
 */

define( function( require ) {
  'use strict';
  
  var inherit = require( 'PHET_CORE/inherit' );
  var Bounds2 = require( 'DOT/Bounds2' );
  var Util = require( 'DOT/Util' );
  
  var Segment = require( 'KITE/segments/Segment' );

  Segment.Line = function Line( start, end ) {
    this._start = start;
    this._end = end;
    
    // TODO: performance test removal of these undefined declarations
    this._tangent = undefined;
    this._bounds = undefined;
  };
  inherit( Segment, Segment.Line, {
    
    getStart: function() {
      return this._start;
    },
    get start() { return this._start; },
    
    getEnd: function() {
      return this._end;
    },
    get end() { return this._end; },
    
    getStartTangent: function() {
      if ( this._tangent === undefined ) {
        // TODO: allocation reduction
        this._tangent = this._end.minus( this._start ).normalized();
      }
      return this._tangent;
    },
    get startTangent() { return this.getStartTangent(); },
    
    getEndTangent: function() {
      return this.getStartTangent();
    },
    get endTangent() { return this.getEndTangent(); },
    
    getBounds: function() {
      // TODO: allocation reduction
      if ( this._bounds === undefined ) {
        this._bounds = Bounds2.dirtyFromPool().addPoint( this._start ).addPoint( this._end );
      }
      return this._bounds;
    },
    get bounds() { return this.getBounds(); },
    
    getNondegenerateSegments: function() {
      // if it is degenerate (0-length), just ignore it
      if ( this._start.equals( this._end ) ) {
        return [];
      } else {
        return [this];
      }
    },
    
    positionAt: function( t ) {
      return this._start.plus( this._end.minus( this._start ).times( t ) );
    },
    
    tangentAt: function( t ) {
      // tangent always the same, just use the start tanget
      return this.getStartTangent();
    },
    
    curvatureAt: function( t ) {
      return 0; // no curvature on a straight line segment
    },
    
    getSVGPathFragment: function() {
      return 'L ' + this._end.x + ' ' + this._end.y;
    },
    
    strokeLeft: function( lineWidth ) {
      var offset = this.getEndTangent().perpendicular().negated().times( lineWidth / 2 );
      return [new Segment.Line( this._start.plus( offset ), this._end.plus( offset ) )];
    },
    
    strokeRight: function( lineWidth ) {
      var offset = this.getStartTangent().perpendicular().times( lineWidth / 2 );
      return [new Segment.Line( this._end.plus( offset ), this._start.plus( offset ) )];
    },
    
    // lines are already monotone
    getInteriorExtremaTs: function() { return []; },
    
    subdivided: function( t ) {
      var pt = this.positionAt( t );
      return [
        new Segment.Line( this._start, pt ),
        new Segment.Line( pt, this._end )
      ];
    },
    
    intersectsBounds: function( bounds ) {
      throw new Error( 'Segment.Line.intersectsBounds unimplemented' ); // TODO: implement
    },
    
    intersection: function( ray ) {
      // We solve for the parametric line-line intersection, and then ensure the parameters are within both
      // the line segment and forwards from the ray.
      
      var result = [];
      
      var start = this._start;
      var end = this._end;
      
      var diff = end.minus( start );
      
      if ( diff.magnitudeSquared() === 0 ) {
        return result;
      }
      
      var denom = ray.dir.y * diff.x - ray.dir.x * diff.y;

      // If denominator is 0, the lines are parallel or coincident
      if ( denom === 0 ) {
        return result;
      }
      
      // linear parameter where start (0) to end (1)
      var t = ( ray.dir.x * ( start.y - ray.pos.y ) - ray.dir.y * ( start.x - ray.pos.x ) ) / denom;
      
      // check that the intersection point is between the line segment's endpoints
      if ( t < 0 || t >= 1 ) {
        return result;
      }
      
      // linear parameter where ray.pos (0) to ray.pos+ray.dir (1)
      var s = ( diff.x * ( start.y - ray.pos.y ) - diff.y * ( start.x - ray.pos.x ) ) / denom;
      
      // bail if it is behind our ray
      if ( s < 0.000001 ) {
        return result;
      }
      
      // return the proper winding direction depending on what way our line intersection is "pointed"
      var perp = diff.perpendicular();
      result.push( {
        distance: s,
        point: start.plus( diff.times( t ) ),
        normal: perp.dot( ray.dir ) > 0 ? perp.negated() : perp,
        wind: ray.dir.perpendicular().dot( diff ) < 0 ? 1 : -1,
        segment: this
      } );
      return result;
    },
    
    // returns the resultant winding number of this ray intersecting this segment.
    windingIntersection: function( ray ) {
      var hits = this.intersection( ray );
      if ( hits.length ) {
        return hits[0].wind;
      } else {
        return 0;
      }
    },
    
    // assumes the current position is at start
    writeToContext: function( context ) {
      context.lineTo( this._end.x, this._end.y );
    },
    
    transformed: function( matrix ) {
      return new Segment.Line( matrix.timesVector2( this._start ), matrix.timesVector2( this._end ) );
    },
    
    explicitClosestToPoint: function( point ) {
      var diff = this._end.minus( this._start );
      var t = point.minus( this._start ).dot( diff ) / diff.magnitudeSquared();
      t = Util.clamp( t, 0, 1 );
      var closestPoint = this.positionAt( t );
      return [{
        segment: this,
        t: t,
        closestPoint: closestPoint,
        distanceSquared: point.distanceSquared( closestPoint )
      }];
    },
    
    // given the current curve parameterized by t, will return a curve parameterized by x where t = a * x + b
    reparameterized: function( a, b ) {
      return new Segment.Line( this.positionAt( b ), this.positionAt( a + b ) );
    }
  } );
  
  return Segment.Line;
} );
