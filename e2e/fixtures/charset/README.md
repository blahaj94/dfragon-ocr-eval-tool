# Charset test fixture

This is a synthetic copy of the supported ldb-ocr run text-file contract. It is not a
trained model. The recorded Windows paths intentionally do not exist locally: the
inspector reads only the selected copy's configuration and hash-verified dictionary.
There are no PNGs, metadata, weights, training reports, manifests, or runtime sources.

The labels contain 7 unique code points. `가` appears 3 times. With `useSpace: true`,
5 unique characters are included (가, space, A, 1, !), and 2 are missing (😀 and U+200B).
Changing both space settings to false makes U+0020 missing as well.
