MarkerClusterGroup
=====================

Provides beautiful marker clustering functionality for Google Maps API v3.

This Project is a port of the awesome [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster). MUCH THANKS!
Sadly it is not as slick and beautiful (no animations) as Leaflet.markercluster, due to some issues with google maps and not enough of my time.

This is a very first version and has a long way to go.

Here is a list of some of the things I have to do:
* Clearing and removing is not yet finished
* Make it more google-maps like
* Test suite
* More example
* More documentation


### Usage
Create a new MarkerClusterGroup, add your markers to it, then add it to the map

```javascript
var clusterer = new MAP.MarkerClusterGroup();

clusterer.addLayer(new google.maps.Marker({ position: new google.maps.LatLng(42.7,23.36) });

clusterer.setMap(gmap);
```

### Examples Usage

The [realworld example](https://avalith.github.io/MarkerClusterGroup/examples/marker-clustering-realworld.388.html) is a good place to start, it uses all of the defaults of the clusterer.

