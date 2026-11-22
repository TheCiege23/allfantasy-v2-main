# LeagueSafe Phase 2 fixtures

Eight redacted MIME fixtures derived from eight checksum-verified private originals.
The originals remain outside this public repository. Template wording, HTML/table
structure and observed field relationships are retained; people, leagues, amounts,
addresses, message IDs, transaction references, confirmation codes and URLs are synthetic.
Styles, tracking images, original delivery headers and all private voting links were removed.
The only retained LeagueSafe link shape uses the synthetic league ID `1234567`.

`Authentication-Results` in these fixtures is **synthetic test input**, not proof of
delivery authentication. All dates/addresses in the MIME envelope are synthetic.
The vote request uses quoted-printable; the other fixtures use base64. Tests also
exercise nested MIME, attached originals, duplicate headers, malformed input and limits.

| Fixture | Observed meaning |
| --- | --- |
| payment-received | Commissioner notice of a member's payment; no transaction or numeric league ID |
| wallet-refund / wallet-refund-variant | Card refund returned to Fanball Wallet; transaction reference available |
| league-refund | Commissioner notice; owner text and league name, no transaction ID |
| wallet-credit | League winnings credited to SportsHub account; external withdrawal still required |
| allocation-vote-request | Proposed owner distributions awaiting a vote |
| allocation-approved | Allocation vote approved; distribution subject to available funds |
| payout-structure-update | League payout rules changed; observed Place/Prize table empty |

Checksums of the redacted fixture bytes (SHA-256):

```text
16b12bbe7f654c93d474ba7276063c51af890f01074db88df9eee9b5b343d28a  allocation-approved.eml
cd841fbc83301fbadcd0ced758537c6c119b49ccc8771dfa9259b329663b46d3  allocation-vote-request.eml
f849a29647403aef8a6b5358d943672d4749e4e67dc8bfc71be4324a7d55a96a  league-refund.eml
f3036bae0c4e7e4b63e06dd905ba6ef6c110a0dd2134646662a7ed3afc40966f  payment-received.eml
16ed909e26ce885fbe72a91d68ef226bb4bd8161a30c8d01725211b5cb7d3bf0  payout-structure-update.eml
e01c896d112a4ce26103e94c32ff45bdab4d424783d73c535ad885829d1b698e  wallet-credit.eml
8453f9da4a916f0cd6d9bf39002287bca9f00dcee1dc2c19c35cc5a1f75bc7fe  wallet-refund-variant.eml
5640062979bf8985cbcf0c55c342ad7c4583f266de74e1438bd5b76d196aa322  wallet-refund.eml
```

Fixture parsing proves extraction behavior only. It does not complete the pending
live refund/payout authentication or delivery checks. No withdrawal, completed
external payout, late-fee or other unobserved notification template is fabricated.
