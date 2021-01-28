const EthereumTx = require('ethereumjs-tx')
const { generateErrorResponse } = require('../helpers/generate-response')
const  { validateCaptcha } = require('../helpers/captcha-helper')
const { debug } = require('../helpers/debug')

//ABI for ERC20 transfer
const TransferABI = [
	// transfer
	{
	 "constant": false,
	 "inputs": [
	  {
	   "name": "_to",
	   "type": "address"
	  },
	  {
	   "name": "_value",
	   "type": "uint256"
	  }
	 ],
	 "name": "transfer",
	 "outputs": [
	  {
	   "name": "",
	   "type": "bool"
	  }
	 ],
	 "type": "function"
	}
];

module.exports = function (app) {
	const config = app.config
	const web3 = app.web3

	const messages = {
		INVALID_CAPTCHA: 'Invalid captcha',
		INVALID_ADDRESS: 'Invalid address',
		TX_HAS_BEEN_MINED_WITH_FALSE_STATUS: 'Transaction has been mined, but status is false',
		TX_HAS_BEEN_MINED: 'Tx has been mined',
		TX_HAS_BEEN_SENt: 'Tx has been sent. Please verify whether the transaction was executed.'
	}

	app.post('/', async function(request, response) {
		const isDebug = app.config.debug
		if(!Boolean(app.config.Captcha.required)) {
			await sendBZZAndEth(web3, request.body.receiver, response, isDebug)	
		}
		debug(isDebug, "REQUEST:")
		debug(isDebug, request.body)
		const recaptureResponse = request.body["g-recaptcha-response"]
		if (!recaptureResponse) {
			const error = {
				message: messages.INVALID_CAPTCHA,
			}
			return generateErrorResponse(response, error)
		}

		let captchaResponse
		try {
			captchaResponse = await validateCaptcha(app, recaptureResponse)
		 } catch(e) {
			return generateErrorResponse(response, e)
		 }
		if (await validateCaptchaResponse(captchaResponse, request.body.receiver, response)) {
			await sendBZZAndEth(web3, request.body.receiver, response, isDebug)
		}
	});

	app.get('/health', async function(request, response) {
		let balanceInWei
		let balanceInEth
		const address = config.Ethereum[config.environment].account
		try {
			balanceInWei = await web3.eth.getBalance(address)
			balanceInEth = await web3.utils.fromWei(balanceInWei, "ether")
		} catch (error) {
			return generateErrorResponse(response, error)
		}

		const resp = {
			address,
			balanceInWei: balanceInWei,
			balanceInEth: Math.round(balanceInEth)
		}
		response.send(resp)
	});

	async function validateCaptchaResponse(captchaResponse, receiver, response) {
		if (!captchaResponse || !captchaResponse.success) {
			generateErrorResponse(response, {message: messages.INVALID_CAPTCHA})
			return false
		}

		return true
	}

	async function sendBZZAndEth(web3, receiver, response, isDebug) {
		const BN = web3.utils.BN
		let senderPrivateKey = config.Ethereum.prod.privateKey
		const privateKeyHex = Buffer.from(senderPrivateKey, 'hex')
		if (!web3.utils.isAddress(receiver)) {
			return generateErrorResponse(response, {message: messages.INVALID_ADDRESS})
		}
		var batch = new web3.BatchRequest();

		const gasPriceHex = web3.utils.toHex(web3.utils.toWei('1', 'gwei'))

		let nonce = await web3.eth.getTransactionCount(config.Ethereum.prod.account)

		// send BZZ
		var abiArray = JSON.parse(JSON.stringify(TransferABI));
		var contract = new web3.eth.Contract(abiArray, config.Token.tokenAddress);
		
		var rawTXToken = {
    		nonce: web3.utils.toHex(nonce),
    		gasPrice: gasPriceHex,
			gasLimit: web3.utils.toHex(config.Token.gasLimit),
			to: config.Token.tokenAddress,
    		data: (contract.methods.transfer(receiver, config.Token.tokenToTransfer).encodeABI()).toString('hex')
		};

		
		// increment nonce
		

		const txToken = new EthereumTx(rawTXToken)
		txToken.sign(privateKeyHex)
		const serializedTokenTx = txToken.serialize()
		batch.add(web3.eth.sendSignedTransaction.request("0x" + serializedTokenTx.toString('hex')));
		
		nonce = nonce +1
		// send Eth
		const gasLimitHex = web3.utils.toHex(config.Ethereum.gasLimit)
		
		const ethToSend = web3.utils.toWei(new BN(config.Ethereum.milliEtherToTransfer), "milliether")
		const rawTxEth = {
		  nonce: web3.utils.toHex(nonce),
		  gasPrice: gasPriceHex,
		  gasLimit: gasLimitHex,
		  to: receiver, 
		  value: ethToSend,
		  data: '0x00'
		}
		const txEth = new EthereumTx(rawTxEth)
		txEth.sign(privateKeyHex)

		const serializedEthTx = txEth.serialize()

		batch.add(web3.eth.sendSignedTransaction.request("0x" + serializedEthTx.toString('hex')));

		try {
			await batch.execute()
		} catch(e) {
			return generateErrorResponse(response, e)
		} finally {
			const successResponse = {
				code: 200, 
				title: 'Success', 
				message: messages.TX_HAS_BEEN_SENt,
				faucetAddress: `https://goerli.etherscan.io/address/${config.Ethereum.prod.account}`
			}
			response.send({
				success: successResponse
			})
		}
	}

	function sendRawTransactionResponse(txHash, response) {
		const successResponse = {
			code: 200, 
			title: 'Success', 
			message: messages.TX_HAS_BEEN_MINED,
			txHash: txHash
		}
	  	
	  	response.send({
	  		success: successResponse
	  	})
	}
}