
var Bottleneck = require("bottleneck");
//const { TaskTimer } = require('tasktimer');
// Restrict us to two request per second
 const limiter = new Bottleneck({
 	minTime: 0,
 	maxConcurrent: 2
 });
 const throttledcity= limiter.wrap(city);
//var number=0;
var locations = ["London","Paris","Rome","New York","Cairo","Budapest","Sydney","Auckland","Melbourne","Tokyo"];
var processed=[];

main()
async function main () {
	 // fire off requests for all locations
	locations.map( location => {
		value =throttledcity(1000,location)
		console.log(value) //outputs promises only.
	})//onebatch
	await arewethereyet()
	console.log("finished")
} //main

async function city (time, val) {
	processed.push(val)
	await timeout(time)	
	console.log("processed: "+val)
	return await val
}

function timeout(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function arewethereyet(){
	number=10
	while (processed.length != number) {
		
		await new Promise((resolve, reject) => setTimeout(resolve, 2000));
	
		if(number==processed.length){
			return  true //console.log("hurra the end")
		}
	}
}

	// const timer = new TaskTimer(2000); //checks state periodically if all is processed stops the timer
	// timer.on('tick', () =>{console.log(`Length of processed ${processed.length}. Items: \n ${processed}\n\n`)
	// if (processed.length == 10){
	// 	timer.stop()
	// 	finished =true

	// } 
	// });
	// timer.start();