import { Signer } from '@ethersproject/abstract-signer'
import { Provider } from '@ethersproject/abstract-provider'

import {
  L1ToL2MessageGasEstimator,
  L1toL2MessageGasValues,
} from './L1ToL2MessageGasEstimator'
import { L1TransactionReceipt } from './L1Transaction'
import { Inbox__factory } from '../abi/factories/Inbox__factory'
import { l2Networks } from '../dataEntities/networks'
import { ContractReceipt, PayableOverrides } from '@ethersproject/contracts'
import { BigNumber } from 'ethers'
import { SignerProviderUtils } from '../dataEntities/signerOrProvider'
import { MissingProviderArbTsError } from '../dataEntities/errors'

interface CreateRetryableTicketOpptions {
  excessFeeRefundAddress?: string
  callValueRefundAddress?: string
}
export class L1ToL2MessageCreator {
  sender?: string
  constructor(public readonly l1Signer: Signer) {
    if (!SignerProviderUtils.signerHasProvider(l1Signer)) {
      throw new MissingProviderArbTsError('l1Signer')
    }
  }

  public async createRetryableTicketFromGasParams(
    gasParams: L1toL2MessageGasValues,
    destAddr: string,
    callDataHex: string,
    l2ChainID: number,
    options: CreateRetryableTicketOpptions = {
      excessFeeRefundAddress: undefined,
      callValueRefundAddress: undefined,
    },
    overrides: PayableOverrides = {}
  ): Promise<ContractReceipt> {
    const {
      maxFeePerGas,
      maxSubmissionFee,
      gasLimit,
      totalL2GasCosts,
      l2CallValue,
    } = gasParams
    const sender = await this.getSender()
    const excessFeeRefundAddress = options.excessFeeRefundAddress || sender
    const callValueRefundAddress = options.callValueRefundAddress || sender

    const inboxAddress = l2Networks[l2ChainID].ethBridge.inbox
    const inbox = Inbox__factory.connect(inboxAddress, this.l1Signer)

    const res = await inbox.createRetryableTicket(
      destAddr,
      l2CallValue,
      maxSubmissionFee,
      excessFeeRefundAddress,
      callValueRefundAddress,
      gasLimit,
      maxFeePerGas,
      callDataHex,
      { value: totalL2GasCosts.add(l2CallValue), ...overrides }
    )
    return res.wait()
  }

  public async createRetryableTicket(
    destAddr: string,
    callDataHex: string,
    l2CallValue: BigNumber,
    l2Provider: Provider,
    options: CreateRetryableTicketOpptions = {
      excessFeeRefundAddress: undefined,
      callValueRefundAddress: undefined,
    }
  ): Promise<L1TransactionReceipt> {
    const sender = await this.getSender()
    const gasEstimator = new L1ToL2MessageGasEstimator(l2Provider)
    const baseFee = (await this.l1Signer.provider!.getBlock('latest'))
      .baseFeePerGas!
    const gasParams = await gasEstimator.estimateMessage(
      sender,
      destAddr,
      callDataHex,
      l2CallValue,
      baseFee,
      sender,
      sender
    )
    const l2ChainID = (await l2Provider.getNetwork()).chainId
    const rec = await this.createRetryableTicketFromGasParams(
      { ...gasParams, l2CallValue },
      destAddr,
      callDataHex,
      l2ChainID,
      options
    )

    return new L1TransactionReceipt(rec)
  }

  public async getSender(): Promise<string> {
    if (!this.sender) {
      const sender = await this.l1Signer.getAddress()
      this.sender = sender
      return sender
    }
    return this.sender
  }
}
