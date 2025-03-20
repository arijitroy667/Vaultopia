import {
    LidoSDK,
    LidoSDKCore,
    StakeStageCallback,
    TransactionCallbackStage,
    SDKError,
  } from '@lidofinance/lido-ethereum-sdk';import { createPublicClient, createWalletClient, http, Address, PublicClient, encodeFunctionData } from 'viem';
import { holesky } from 'viem/chains';
import { custom } from 'viem';
import vaultProvider  from './web3Provider';

// Set up your providers
const rpcProvider = createPublicClient({
  chain: holesky,
  transport: http("https://eth-holesky.g.alchemy.com/v2/NZ1c4Vu21IOmBWCLeIe2oVMFLgLbfMLs"),
});

// Initialize the Lido SDK with your custom vault provider
const walletClient = createWalletClient({
  chain: holesky,
  transport: custom(vaultProvider)
});

const lidoSDK = new LidoSDK({
  chainId: 17000,
  rpcProvider,
  web3Provider: walletClient,
});

const callback: StakeStageCallback = ({ stage, payload }) => {
    switch (stage) {
      case TransactionCallbackStage.SIGN:
        console.log('wait for sign');
        break;
      case TransactionCallbackStage.RECEIPT:
        console.log('wait for receipt');
        console.log(payload, 'transaction hash');
        break;
      case TransactionCallbackStage.CONFIRMATION:
        console.log('wait for confirmation');
        console.log(payload, 'transaction receipt');
        break;
      case TransactionCallbackStage.DONE:
        console.log('done');
        console.log(payload, 'transaction confirmations');
        break;
      case TransactionCallbackStage.ERROR:
        console.log('error');
        console.log(payload, 'error object with code and message');
        break;
      default:
    }
  };


  try {
    const stakeTx = await lidoSDK.stake.stakeEth({
      value,
      callback,
      referralAddress,
      account,
    });
  
    console.log(
      stakeTx,
      'transaction hash, transaction receipt, confirmations, stake result',
      stakeTx.result.stethReceived,
      stakeTx.result.sharesReceived,
    );
  } catch (error) {
    console.log((error as SDKError).errorMessage, (error as SDKError).code);
  }