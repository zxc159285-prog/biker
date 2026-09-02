fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: '[out:json];way["name"="독산로76길"];out tags;' }).then(r=>r.json()).then(j => console.log(j.elements)).catch(console.error);
