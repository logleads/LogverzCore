
var Bottleneck = require("bottleneck");
// Background : Inorder to controll job execution paralellism and frequency we use bottleneck. 
// Bottleneck  -BN from here on- has an internall queuefrom which starts jobs. So we start processing by placeing jobs in BN.
// Example We have 40 items to process in total, we submit 10 jobs to BN , and configure BN to process two jobs parralell.
// If we dont submit new jobs BN will only process 10 items and not more, we could create same ammount of jobs as items,
// however thats not scalable, probably not work for 400Kitems and  almost certainly for 4-40M jobs. 


const limiter = new Bottleneck({
	minTime: 0,
	maxConcurrent: 2 // Restrict us to two request per second
});

const throttledwork= limiter.wrap(work);
var processed=[];
var jobs=[];
var jobquelength = 10;
var numberofitems=40;
var finish=false

main()
async function main () {
	//create jobs
	 for(var i = 0; i < jobquelength; i++) {
		jobs.push(i);
	}
	 // submit jobs to the queue 
	jobs.map( job => {
		value =throttledwork(1000,job)
		console.log(value) //outputs promises only.
	})//onebatch
	
} //main

async function work (time, val) {
	
	if (processed.length >=numberofitems){
		finish= true
		console.log("done")
	}else{
		processed.push(val)
		await timeout(time)	
		var counts = limiter.counts();
		if ((counts.RECEIVED <=3) && (counts.QUEUED<=3)&&(!finish)){
			submitnewjobs()
		}
		console.log(counts)
		console.log("processed: "+processed.length)
		return await val
	}

}

function timeout(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function submitnewjobs(){
	console.log("replenishing queue");
	var newjobs=[];
	for(var i = 0; i < jobquelength; i++) {
		newjobs.push(i);
	}
	newjobs.map( job => {
		value =throttledwork(1000,job);
		console.log(value) //outputs promises only.
	})
}
