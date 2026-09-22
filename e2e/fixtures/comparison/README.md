# Comparison test fixtures

These are synthetic schema-version-1 reports, not model inference or performance results.
`roi.png` is one deterministic generated image reused by all four fixture samples.
Tests copy it to each sample's path and replace the `/fixture` paths in temporary reports.
The source, checkpoint, configuration, and training hashes are test-only constants.

Both reports contain the same four IDs and unmodified truths (including the spaces in
`" a "`). B deliberately changes array order, checkpoint, configuration, preprocessing,
and pooling while preserving the two scoring-source hashes and normalization policy.

| Report | Samples | Truth code points | Exact matches | Edit distance | CER |
| ------ | ------: | ----------------: | ------------: | ------------: | --: |
| A      |       4 |                10 |             2 |             4 | 0.4 |
| B      |       4 |                10 |             2 |             2 | 0.2 |

There is one sample in each comparison group: regressed, improved, both correct, and both wrong.
