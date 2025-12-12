import { NextResponse } from "next/server"
import { ethers } from "ethers"

const DEFAULT_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const DEFAULT_RECEIVER = "0x03173186D626031276F7bfa1f3af0E19f54DdCE6"
const DEFAULT_AMOUNT = "0.30"
const USDC_DECIMALS = 6

const parseUnitsSafe = (amount: string, decimals: number) => {
  const [intPart = "0", fracPart = ""] = amount.split(".")
  const frac = (fracPart + "0".repeat(decimals)).slice(0, decimals)
  const normalized = `${intPart}${frac}`.replace(/^0+/, "") || "0"
  return BigInt(normalized)
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { txHash, request, lang, limit } = body || {}

    if (!txHash || !request) {
      return NextResponse.json({ error: "txHash and request are required" }, { status: 400 })
    }

    const rpcUrl = process.env.BASE_RPC_URL
    if (!rpcUrl) {
      return NextResponse.json({ error: "RPC URL not configured" }, { status: 500 })
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const receipt = await provider.getTransactionReceipt(txHash)

    if (!receipt || receipt.status !== 1n) {
      return NextResponse.json({ error: "Transaction not found or failed" }, { status: 402 })
    }

    const usdcAddress = (process.env.BASE_USDC_ADDRESS || DEFAULT_USDC).toLowerCase()
    const receiver = (process.env.BASE_PAYMENT_RECEIVER || DEFAULT_RECEIVER).toLowerCase()
    const expectedAmount = parseUnitsSafe(process.env.PAYMENT_AMOUNT_USDC || DEFAULT_AMOUNT, USDC_DECIMALS)

    const iface = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"])

    const matched = receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== usdcAddress) return false
      try {
        const parsed = iface.parseLog({ data: log.data, topics: log.topics })
        const to = (parsed.args?.to as string)?.toLowerCase()
        const value = parsed.args?.value as bigint
        return to === receiver && value === expectedAmount
      } catch {
        return false
      }
    })

    if (!matched) {
      return NextResponse.json({ error: "Payment not detected or amount mismatch" }, { status: 402 })
    }

    const apiUrl = process.env.LEAKOSINT_API_URL
    const apiToken = process.env.LEAKOSINT_API_TOKEN

    if (!apiUrl || !apiToken) {
      return NextResponse.json({ error: "External API configuration missing" }, { status: 500 })
    }

    const payload: any = { token: apiToken, request }
    if (lang) payload.lang = lang
    if (limit) payload.limit = limit

    const externalResp = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    const data = await externalResp.json().catch(() => ({}))
    if (!externalResp.ok) {
      return NextResponse.json({ error: data?.error || "External API error" }, { status: 502 })
    }

    return NextResponse.json(data, { status: 200 })
  } catch (error: any) {
    console.error("x402 verify error:", error)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}




