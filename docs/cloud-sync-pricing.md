# Cloud sync pricing

Checked on 2026-11-24 using official CloudBase documentation. Prices below are published reference prices, not a live purchase-order quotation. Promotions, renewal offers and the final console order price were not verified.

## Published monthly plans

| Plan | Monthly fee | Included resource points |
| --- | ---: | ---: |
| Free trial | CNY 0 | 3,000 |
| Personal | CNY 19.9 | 40,000 |
| Standard | CNY 199 | 330,000 |
| Enterprise | CNY 999 | 1,500,000 |

Source: [official resource-point FAQ](https://docs.cloudbase.net/quick-start/resource-point). These are the values explicitly listed by that page. It does not label these amounts as temporary promotional discounts. A [2026-01-16 release announcement](https://docs.cloudbase.net/changelog/updates/resource-points-billing) also mentions Enterprise Advanced as supported by resource-point billing, but its monthly price is not confirmed by the FAQ inspected here.

## Resource charges and overage

CloudBase converts database operations, function use, storage and CDN traffic into one shared resource-point pool. The FAQ gives **1,000 points = CNY 1** for overage and an example resource pack of CNY 10 for 10,000 points, valid for one year. Deduction order is **plan points → resource pack → pay-as-you-go**. This is the published billing sequence for eligible paid environments, not evidence that overage billing is enabled for this app. [Source](https://docs.cloudbase.net/quick-start/resource-point).

The FAQ labels the following conversion rates as Standard-plan examples:

| Resource | Published example rate |
| --- | ---: |
| Database calls | 200 points / 10,000 calls |
| Function calls | 13 points / 10,000 calls |
| CDN traffic | 210 points / GB |
| MySQL capacity | 0.5 points / GB-hour |
| SMS | 50 points / message |

Source: [official resource-point FAQ](https://docs.cloudbase.net/quick-start/resource-point). Its illustrative estimation formula uses 13.3 points for 10,000 function calls, rather than the table's rounded 13; these examples should not be treated as a precise invoice calculator. The formula also lists storage at 1,200 points per GB without clearly defining the time period, so this note does not convert that into a monthly storage price.

The inspected FAQ does **not** establish precise current rates for PG compute/capacity, PG object storage, non-CDN egress, HTTP gateway traffic, or function execution duration and memory. The MySQL example must not be applied to this app's PostgreSQL environment. Function invocation counts alone do not establish the total cost of executing this app. The linked [official detailed price document](https://cloud.tencent.com/document/product/876/127357) was retrieved but did not expose readable price content through this method; those detailed rates remain unconfirmed.

## This app's current account

Account facts were checked separately in the console on 2026-11-23 and are recorded in [current cloud limits](cloud-upload-current-limits.md):

- The environment is on the free trial with 3,000 shared resource points; pay-as-you-go is disabled.
- The trial does not support pay-as-you-go or resource-pack purchases. The official FAQ also says a free-trial environment must first upgrade to a paid plan to switch to the paid resource-point model.
- The package is valid through 2027-05-12. The 2026-12-12 date is the current quota-period end, not the package expiry.

The practical current fee is CNY 0 while the trial remains usable. The paid overage rate is not authorization to automatically charge this trial environment. If the trial quota is exhausted, service availability is the concern rather than ordinary paid overage. An exact shutdown scope and recovery timeline were not confirmed from the official pages inspected; do not promise continued sync after exhausting the free quota.

The lowest published paid plan in the FAQ is Personal at CNY 19.9/month. Moving to it would require an explicit purchase. Additional points would be charged only under the applicable paid plan and enabled billing/purchase settings; no plan or cloud configuration was changed during this research.

## Boundaries

CloudBase costs are separate from the journaling app's AI-provider costs, which depend on the user's configured provider and model. Current free quota usage does not provide a reliable monthly paid-cost forecast without a complete quota-period usage history and applicable PG/function/storage rates.
