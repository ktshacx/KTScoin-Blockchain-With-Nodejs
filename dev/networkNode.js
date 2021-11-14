const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const Blockchain = require('./blockchain');
const uuid = require('uuid/v1');
const port = process.argv[2];
const rp = require('request-promise');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const genKey = require("./keygenerator");
require('dotenv').config();

const nodeAddress = uuid().split('-').join('');

const KTScoin = new Blockchain();


app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));


app.get('/api', function (req, res) {
	res.json({message: 'This is KTSCoin Blockchain'})
})

// get entire blockchain
app.get('/blockchain', function (req, res) {
  res.send(KTScoin);
});

app.get('/newkey', function (req, res) {
	const privateKey = genKey();
	const myKey = ec.keyFromPrivate(privateKey);
	const publicKey = myKey.getPublic('hex');

	res.json({
		privateKey: privateKey,
		publicKey: publicKey
	})
})


// create a new transaction
app.post('/transaction', function(req, res) {
	const newTransaction = req.body;
	const blockIndex = KTScoin.addTransactionToPendingTransactions(newTransaction);
	res.json({ note: `Transaction will be added in block ${blockIndex}.` });
});


// broadcast transaction
app.post('/transaction/broadcast', function(req, res) {
		const myKey = ec.keyFromPrivate(req.body.sender);
	    const myWalletAddress = myKey.getPublic('hex');
	    const addressData = KTScoin.getAddressData(myWalletAddress);
		if(myWalletAddress == process.env.ADMIN_WALLET){
			transact(req.body.amount, myWalletAddress, req.body.recipient);
		    res.json({ note: 'Transaction created and broadcast successfully.' });
			console.log(1)
		} else {
			 if (addressData.addressBalance < req.body.amount) {
		        res.json({ note: 'Insufficient Balance'});
			    // console.log(addressData.addressBalance)
		    } else {
			    transact(req.body.amount, myWalletAddress, req.body.recipient);
		        res.json({ note: 'Transaction created and broadcast successfully.' });
			    // console.log(addressData.addressBalance)
				console.log(2)
		}
	}
});

function transact(amount, sender, recipient) {
	const newTransaction = KTScoin.createNewTransaction(amount, sender, recipient);


	const requestPromises = [];
	KTScoin.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/transaction',
			method: 'POST',
			body: newTransaction,
			json: true
		};

		requestPromises.push(rp(requestOptions));
	});
}


// mine a block
app.get('/mine/:id', function(req, res) {
	const lastBlock = KTScoin.getLastBlock();
	const id = req.params.id;
	const previousBlockHash = lastBlock['hash'];
	const currentBlockData = {
		transactions: KTScoin.pendingTransactions,
		index: lastBlock['index'] + 1
	};
	if(KTScoin.pendingTransactions == ""){
		res.json({
			note: "no block to mine"
		})
	
	} else {
	var fees = 0;
	for(var i = 0; i < KTScoin.pendingTransactions.length; i++){
		fees = fees + KTScoin.pendingTransactions[i].fees;
	}

	if (fees != 0){
		KTScoin.networkNodes.forEach(networkNodeUrl => {
			const requestOption = {
				uri: networkNodeUrl + '/transaction/broadcast',
				method: 'POST',
				body: { 
						"amount": fees,
						"recipient": id,
						"sender": process.env.ADMIN_PRIVATE,
						"fees": "no"
				 },
				json: true
			};
			rp(requestOption);
			console.log(requestOption)
		});
	}


	const nonce = KTScoin.proofOfWork(previousBlockHash, currentBlockData);
	const blockHash = KTScoin.hashBlock(previousBlockHash, currentBlockData, nonce);
	const newBlock = KTScoin.createNewBlock(nonce, previousBlockHash, blockHash);
	
	const requestPromises = [];
	KTScoin.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/receive-new-block',
			method: 'POST',
			body: { newBlock: newBlock },
			json: true
		};

		requestPromises.push(rp(requestOptions));
	});

	res.json({
		note: "New block mined & broadcast successfully",
		block: newBlock
	});

	}
});


// receive new block
app.post('/receive-new-block', function(req, res) {
	const newBlock = req.body.newBlock;
	const lastBlock = KTScoin.getLastBlock();
	const correctHash = lastBlock.hash === newBlock.previousBlockHash; 
	const correctIndex = lastBlock['index'] + 1 === newBlock['index'];

	if (correctHash && correctIndex) {
		KTScoin.chain.push(newBlock);
		KTScoin.pendingTransactions = [];
		res.json({
			note: 'New block received and accepted.',
			newBlock: newBlock
		});
	} else {
		res.json({
			note: 'New block rejected.',
			newBlock: newBlock
		});
	}
});


// register a node and broadcast it the network
app.post('/register-and-broadcast-node', function(req, res) {
	const newNodeUrl = req.body.newNodeUrl;
	if (KTScoin.networkNodes.indexOf(newNodeUrl) == -1) KTScoin.networkNodes.push(newNodeUrl);

	const regNodesPromises = [];
	KTScoin.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/register-node',
			method: 'POST',
			body: { newNodeUrl: newNodeUrl },
			json: true
		};

		regNodesPromises.push(rp(requestOptions));
	});

	Promise.all(regNodesPromises)
	.then(data => {
		const bulkRegisterOptions = {
			uri: newNodeUrl + '/register-nodes-bulk',
			method: 'POST',
			body: { allNetworkNodes: [ ...KTScoin.networkNodes, KTScoin.currentNodeUrl ] },
			json: true
		};

		return rp(bulkRegisterOptions);
	})
	.then(data => {
		res.json({ note: 'New node registered with network successfully.' });
	});
});


// register a node with the network
app.post('/register-node', function(req, res) {
	const newNodeUrl = req.body.newNodeUrl;
	const nodeNotAlreadyPresent = KTScoin.networkNodes.indexOf(newNodeUrl) == -1;
	const notCurrentNode = KTScoin.currentNodeUrl !== newNodeUrl;
	if (nodeNotAlreadyPresent && notCurrentNode) KTScoin.networkNodes.push(newNodeUrl);
	res.json({ note: 'New node registered successfully.' });
});


// register multiple nodes at once
app.post('/register-nodes-bulk', function(req, res) {
	const allNetworkNodes = req.body.allNetworkNodes;
	allNetworkNodes.forEach(networkNodeUrl => {
		const nodeNotAlreadyPresent = KTScoin.networkNodes.indexOf(networkNodeUrl) == -1;
		const notCurrentNode = KTScoin.currentNodeUrl !== networkNodeUrl;
		if (nodeNotAlreadyPresent && notCurrentNode) KTScoin.networkNodes.push(networkNodeUrl);
	});

	res.json({ note: 'Bulk registration successful.' });
});


// consensus
app.get('/consensus', function(req, res) {
	const requestPromises = [];
	KTScoin.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/blockchain',
			method: 'GET',
			json: true
		};

		requestPromises.push(rp(requestOptions));
	});

	Promise.all(requestPromises)
	.then(blockchains => {
		const currentChainLength = KTScoin.chain.length;
		let maxChainLength = currentChainLength;
		let newLongestChain = null;
		let newPendingTransactions = null;

		blockchains.forEach(blockchain => {
			if (blockchain.chain.length > maxChainLength) {
				maxChainLength = blockchain.chain.length;
				newLongestChain = blockchain.chain;
				newPendingTransactions = blockchain.pendingTransactions;
			};
		});


		if (!newLongestChain || (newLongestChain && !KTScoin.chainIsValid(newLongestChain))) {
			res.json({
				note: 'Current chain has not been replaced.',
				chain: KTScoin.chain
			});
		}
		else {
			KTScoin.chain = newLongestChain;
			KTScoin.pendingTransactions = newPendingTransactions;
			res.json({
				note: 'This chain has been replaced.',
				chain: KTScoin.chain
			});
		}
	});
});


// get block by blockHash
app.get('/block/:blockHash', function(req, res) { 
	const blockHash = req.params.blockHash;
	const correctBlock = KTScoin.getBlock(blockHash);
	res.json({
		block: correctBlock
	});
});


// get transaction by transactionId
app.get('/transaction/:transactionId', function(req, res) {
	const transactionId = req.params.transactionId;
	const trasactionData = KTScoin.getTransaction(transactionId);
	res.json({
		transaction: trasactionData.transaction,
		block: trasactionData.block
	});
});


// get address by address
app.get('/address/:address', function(req, res) {
	const address = req.params.address;
	const addressData = KTScoin.getAddressData(address);
	const addressTransaction = addressData.addressTransactions;
	res.json({
		addressData: addressData
	});
});

app.post('/privatekey/', function(req, res) {
	const myKey = ec.keyFromPrivate(req.body.key);
	const myWalletAddress = myKey.getPublic('hex');
	const addressData = KTScoin.getAddressData(myWalletAddress);

	res.json({
		publicKey: myWalletAddress
	})
})





app.listen(port, function() {
	console.log(`Listening on port ${port}...`);
});





