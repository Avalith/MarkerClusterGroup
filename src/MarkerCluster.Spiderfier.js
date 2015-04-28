(function()
{
	//This code is 100% based on https://github.com/jawj/OverlappingMarkerSpiderfier-Leaflet
	//Huge thanks to jawj for implementing it first to make my job easy :-)
	
	var	GM = google.maps
	,	GE = GM.event
	;
	
	MAP.MarkerCluster.prototype.spiderfy = function()
	{
		if (this._group._spiderfied === this || this._group._inZoomAnimation){ return; }
		
		var	positions
		,	childMarkers	= this.getAllChildMarkers()
		,	group			= this._group
		,	center			= group.getProjection().fromLatLngToContainerPixel(this.position)
		;
		
		// console.warn(center, this.position);
		
		group._unspiderfy();
		group._spiderfied = this;
		
		//TODO Maybe: childMarkers order by distance to center
		if (childMarkers.length >= this._circleSpiralSwitchover) {
			positions = this._generatePointsSpiral(childMarkers.length, center);
		} else {
			center.y += 10; //Otherwise circles look wrong
			positions = this._generatePointsCircle(childMarkers.length, center);
		}
		
		this._animationSpiderfy(childMarkers, positions);
	};
	
	
	MAP.MarkerCluster.prototype.unspiderfy = function(zoomDetails)
	{
		if(this._group._inZoomAnimation){ return; }
		
		this._animationUnspiderfy(zoomDetails);
		this._group._spiderfied = null;
	};
	
	
	MAP.MarkerCluster.prototype._2PI					= Math.PI * 2;
	MAP.MarkerCluster.prototype._circleStartAngle		= Math.PI / 6;
	MAP.MarkerCluster.prototype._circleFootSeparation	= 23; // related to circumference of circle
	
	MAP.MarkerCluster.prototype._spiralFootSeparation	= 26; // related to size of spiral (experiment!)
	MAP.MarkerCluster.prototype._spiralLengthStart		= 11;
	MAP.MarkerCluster.prototype._spiralLengthFactor		= 4;
	
	// show spiral instead of circle from this marker count upwards.
	// 0 -> always spiral; Infinity -> always circle
	MAP.MarkerCluster.prototype._circleSpiralSwitchover	= 9;
	
	
	MAP.MarkerCluster.prototype._generatePointsCircle = function(count, centerPt)
	{
		var circumference = this._group.options.spiderfyDistanceMultiplier * this._circleFootSeparation * (2 + count),
			legLength = circumference / this._2PI,  //radius from circumference
			angleStep = this._2PI / count,
			res = new Array(count),
			i, angle;
		
		for(i = count - 1; i >= 0; i--)
		{
			angle = this._circleStartAngle + i * angleStep;
			res[i] = new GM.Point(parseInt(centerPt.x + legLength * Math.cos(angle)), parseInt(centerPt.y + legLength * Math.sin(angle)));
		}
		
		return res;
	};
	
	
	MAP.MarkerCluster.prototype._generatePointsSpiral = function(count, centerPt)
	{
		var	options			= this._group.options,
			legLength		= options.spiderfyDistanceMultiplier * this._spiralLengthStart,
			separation		= options.spiderfyDistanceMultiplier * this._spiralFootSeparation,
			lengthFactor	= options.spiderfyDistanceMultiplier * this._spiralLengthFactor,
			angle			= 0,
			res				= new Array(count),
			i;
		
		for (i = count - 1; i >= 0; i--)
		{
			angle += separation / legLength + i * 0.0005;
			res[i] = new GM.Point(parseInt(centerPt.x + legLength * Math.cos(angle)), parseInt((centerPt.y + legLength * Math.sin(angle))));
			legLength += this._2PI * lengthFactor / angle;
		}
		
		return res;
	};
	
	/*
	if(MAP.TRANSITIONS)
	{
		MAP.MarkerCluster.prototype.SVG_ANIMATION = (function()
		{
			return document.createElementNS('http://www.w3.org/2000/svg', 'animate').toString().indexOf('SVGAnimate') > -1;
		}()),
		
		MAP.MarkerCluster.prototype._animationSpiderfy = function(childMarkers, positions)
		{
			var	i, m, leg, newPos
			,	me = this
			,	group			= this._group
			,	map				= group._map
			,	fg				= group._featureGroup
			,	thisLayerPos	= this.getProjection().fromLatLngToContainerPixel(this.position)
			;
			
			//Add markers to map hidden at our center point
			for(i = childMarkers.length - 1; i >= 0; i--)
			{
				m = childMarkers[i];
				
				// If it is a marker, add it now and we'll animate it out
				if(m.setOpacity)
				{
					// m.setZIndexOffset(1000000); //Make these appear on top of EVERYTHING
					m.setOpacity(0);
					
					fg.addLayer(m);
					
					m._setPosition(thisLayerPos);
				}
				else
				{
					// Vectors just get immediately added
					fg.addLayer(m);
				}
			}
			
			group._forceLayout();
			group._animationStart();
			
			var initialLegOpacity = L.Path.SVG ? 0 : 0.3,
				xmlns = L.Path.SVG_NS;
			
			for (i = childMarkers.length - 1; i >= 0; i--) {
				newPos = map.layerPointToLatLng(positions[i]);
				m = childMarkers[i];
				
				//Move marker to new position
				m._preSpiderfyLatlng = m.position;
				m.setLatLng(newPos);
				
				if (m.setOpacity) {
					m.setOpacity(1);
				}
				
				//Add Legs.
				leg = new L.Polyline([me.position, newPos], { weight: 1.5, color: '#222', opacity: initialLegOpacity });
				map.addLayer(leg);
				m._spiderLeg = leg;
				
				//Following animations don't work for canvas
				if (!L.Path.SVG || !this.SVG_ANIMATION) {
					continue;
				}
				
				//How this works:
				//http://stackoverflow.com/questions/5924238/how-do-you-animate-an-svg-path-in-ios
				//http://dev.opera.com/articles/view/advanced-svg-animation-techniques/
				
				//Animate length
				var length = leg._path.getTotalLength();
				leg._path.setAttribute("stroke-dasharray", length + "," + length);
				
				var anim = document.createElementNS(xmlns, "animate");
				anim.setAttribute("attributeName", "stroke-dashoffset");
				anim.setAttribute("begin", "indefinite");
				anim.setAttribute("from", length);
				anim.setAttribute("to", 0);
				anim.setAttribute("dur", 0.25);
				leg._path.appendChild(anim);
				anim.beginElement();
				
				//Animate opacity
				anim = document.createElementNS(xmlns, "animate");
				anim.setAttribute("attributeName", "stroke-opacity");
				anim.setAttribute("attributeName", "stroke-opacity");
				anim.setAttribute("begin", "indefinite");
				anim.setAttribute("from", 0);
				anim.setAttribute("to", 0.5);
				anim.setAttribute("dur", 0.25);
				leg._path.appendChild(anim);
				anim.beginElement();
			}
			
			me.setOpacity(0.3);
			
			//Set the opacity of the spiderLegs back to their correct value
			// The animations above override this until they complete.
			// If the initial opacity of the spiderlegs isn't 0 then they appear before the animation starts.
			if (L.Path.SVG) {
				this._group._forceLayout();
				
				for (i = childMarkers.length - 1; i >= 0; i--) {
					m = childMarkers[i]._spiderLeg;
					
					m.options.opacity = 0.5;
					m._path.setAttribute('stroke-opacity', 0.5);
				}
			}
			
			setTimeout(function()
			{
				group._animationEnd();
				group.fire('spiderfied');
			}, 200);
		},
		
		MAP.MarkerCluster.prototype._animationUnspiderfy = function(zoomDetails)
		{
			var group = this._group,
				map = group._map,
				fg = group._featureGroup,
				thisLayerPos = zoomDetails ? map._latLngToNewLayerPoint(this.position, zoomDetails.zoom, zoomDetails.center) : map.latLngToLayerPoint(this.position),
				childMarkers = this.getAllChildMarkers(),
				svg = L.Path.SVG && this.SVG_ANIMATION,
				m, i, a;
			
			group._animationStart();
			
			//Make us visible and bring the child markers back in
			this.setOpacity(1);
			for (i = childMarkers.length - 1; i >= 0; i--) {
				m = childMarkers[i];
				
				//Marker was added to us after we were spidified
				if (!m._preSpiderfyLatlng) {
					continue;
				}
				
				//Fix up the location to the real one
				m.setLatLng(m._preSpiderfyLatlng);
				delete m._preSpiderfyLatlng;
				//Hack override the location to be our center
				if (m.setOpacity) {
					m._setPos(thisLayerPos);
					m.setOpacity(0);
				} else {
					fg.removeLayer(m);
				}
				
				//Animate the spider legs back in
				if (svg) {
					a = m._spiderLeg._path.childNodes[0];
					a.setAttribute('to', a.getAttribute('from'));
					a.setAttribute('from', 0);
					a.beginElement();
					
					a = m._spiderLeg._path.childNodes[1];
					a.setAttribute('from', 0.5);
					a.setAttribute('to', 0);
					a.setAttribute('stroke-opacity', 0);
					a.beginElement();
					
					m._spiderLeg._path.setAttribute('stroke-opacity', 0);
				}
			}
				
			setTimeout(function () {
				//If we have only <= one child left then that marker will be shown on the map so don't remove it!
				var stillThereChildCount = 0;
				for (i = childMarkers.length - 1; i >= 0; i--) {
					m = childMarkers[i];
					if (m._spiderLeg) {
						stillThereChildCount++;
					}
				}
				
				
				for (i = childMarkers.length - 1; i >= 0; i--) {
					m = childMarkers[i];
					
					if (!m._spiderLeg) { //Has already been unspiderfied
						continue;
					}
					
					
					if (m.setOpacity) {
						m.setOpacity(1);
						m.setZIndexOffset(0);
					}
					
					if (stillThereChildCount > 1) {
						fg.removeLayer(m);
					}
					
					map.removeLayer(m._spiderLeg);
					delete m._spiderLeg;
				}
				group._animationEnd();
			}, 200);
		}
	}
	else
	{
	*/
		MAP.MarkerCluster.prototype._animationSpiderfy = function(childMarkers, positions)
		{
			var	i, m, leg, newPos,
				group	= this._group,
				map		= group.map,
				fg		= group._featureGroup
			;
			
			for(i = childMarkers.length - 1; i >= 0; i--)
			{
				newPos = group.getProjection().fromContainerPixelToLatLng(positions[i]);
				
				m = childMarkers[i];
				m._preSpiderfyPosition = m.position;
				m.setPosition(newPos);
				
				// console.log(m.position.toUrlValue(), positions[i].x, positions[i].y);
				fg.addLayer(m);
				
				leg = new GM.Polyline({ map: map, path: [this.position, newPos], strokeWeight: 1.5, strokeColor: '#333', strokeOpacity: 0.5 });
				m._spiderLeg = leg;
			}
			
			this._div.style.display = 'none';
			// this.setOpacity(0.3);
			
			// group.fire('spiderfied');
		};
		
		MAP.MarkerCluster.prototype._animationUnspiderfy = function()
		{
			var	m, i,
				group			= this._group,
				map				= group._map,
				fg				= group._featureGroup,
				childMarkers	= this.getAllChildMarkers()
			;
			
			for(i = childMarkers.length - 1; i >= 0; i--)
			{
				m = childMarkers[i];
				
				fg.removeLayer(m);
				
				if(m._preSpiderfyPosition)
				{
					m.setPosition(m._preSpiderfyPosition);
					delete m._preSpiderfyLatlng;
				}
				
				// if (m.setZIndexOffset) {
				// 	m.setZIndexOffset(0);
				// }
				
				if(m._spiderLeg)
				{
					m._spiderLeg.setMap(null);
					delete m._spiderLeg;
				}
			}
			
			this._div.style.display = 'block';
			
			group._spiderfied = null;
		};
	// }
	
	
	
	
	
	// TODO get all spiderifying outside of MarkerCluster
	
	MAP.MarkerClusterGroup.prototype._spiderfied = null;
	
	MAP.MarkerClusterGroup.prototype._spiderfierOnAdd = function()
	{
		var _this = this;
		// GE.addListener(this.map, 'click', function(e){ _this._unspiderfy(); });
		
		// if (this._map.options.zoomAnimation) {
		// 	this._map.on('zoomstart', this._unspiderfyZoomStart, this);
		// }
		//Browsers without zoomAnimation or a big zoom don't fire zoomstart
		GE.addListener(this.map, 'zoom_changed', function(){ _this._noanimationUnspiderfy(); });
		
		// if (L.Path.SVG && !L.Browser.touch) {
		// 	this.map._initPathRoot();
		// 	//Needs to happen in the pageload, not after, or animations don't work in webkit
		// 	//  http://stackoverflow.com/questions/8455200/svg-animate-with-dynamically-added-elements
		// 	//Disable on touch browsers as the animation messes up on a touch zoom and isn't very noticable
		// }
	};
	
	MAP.MarkerClusterGroup.prototype._unspiderfy = function(zoomDetails)
	{
		if(this._spiderfied){ this._spiderfied.unspiderfy(zoomDetails); }
	};
	
	MAP.MarkerClusterGroup.prototype._noanimationUnspiderfy = function()
	{
		if(this._spiderfied){ this._spiderfied._animationUnspiderfy(); }
	};
	
	
	/*
	L.MarkerClusterGroup.include({
		_spiderfierOnRemove: function () {
			this._map.off('click', this._unspiderfyWrapper, this);
			this._map.off('zoomstart', this._unspiderfyZoomStart, this);
			this._map.off('zoomanim', this._unspiderfyZoomAnim, this);
			
			this._unspiderfy(); //Ensure that markers are back where they should be
		},
		
		
		//On zoom start we add a zoomanim handler so that we are guaranteed to be last (after markers are animated)
		//This means we can define the animation they do rather than Markers doing an animation to their actual location
		_unspiderfyZoomStart: function () {
			if (!this._map) { //May have been removed from the map by a zoomEnd handler
				return;
			}
			
			this._map.on('zoomanim', this._unspiderfyZoomAnim, this);
		},
		_unspiderfyZoomAnim: function (zoomDetails) {
			//Wait until the first zoomanim after the user has finished touch-zooming before running the animation
			if (L.DomUtil.hasClass(this._map._mapPane, 'leaflet-touching')) {
				return;
			}
	
			this._map.off('zoomanim', this._unspiderfyZoomAnim, this);
			this._unspiderfy(zoomDetails);
		},
		
		//If the given layer is currently being spiderfied then we unspiderfy it so it isn't on the map anymore etc
		_unspiderfyLayer: function (layer) {
			if (layer._spiderLeg) {
				this._featureGroup.removeLayer(layer);
	
				layer.setOpacity(1);
				//Position will be fixed up immediately in _animationUnspiderfy
				layer.setZIndexOffset(0);
	
				this._map.removeLayer(layer._spiderLeg);
				delete layer._spiderLeg;
			}
		}
	});
	*/
	
}());