# Predicting “priority” from “subject,body”

> Multilingual Customer Support Tickets. Licence: CC-BY-NC-4.0 (the creator’s current Hugging Face release). Commercial use: no. Non-commercial: experiments only. Don’t assume the current version permits training a model for a product that’s sold. The tickets are synthetic, and the versions share thousands of tickets, so never pool them.

## The decision

Best: words (tf-idf) + logistic regression, balanced accuracy 60% against 33% for always guessing the most common label. The data’s licence doesn’t allow commercial use, so no model is saved: this measures what’s possible, nothing more.

## The setup

28,586 texts, 3 labels, 5-fold stratified cross-validation. Character n-grams work across languages without a tokenizer.

## Results

| Method | Accuracy | Balanced accuracy | Macro F1 |
|---|---:|---:|---:|
| most common label | 40% | 33% | 0.19 |
| words (tf-idf) + logistic regression | 60% | 60% | 0.59 |
| characters (tf-idf) + logistic regression | 52% | 52% | 0.51 |

## Notes

- Source: aa_dataset-tickets-multi-lang-5-2-50-version.csv (25,996,354 bytes, SHA-256 f187c090e59581c2bbf3aa1377c8db4dd647464ecf2ae51bf8966e42e0ed6bc0).
- 28,587 rows in the file; removed 1 repeating a text already in the file (case and spacing ignored); 28,586 measured.
- By language (words (tf-idf) + logistic regression): de 53% of 12,249, en 65% of 16,337.
- 8,308 of these tickets (29%) also appear in dataset-tickets-multi-lang-4-20k.csv: the files are versions of one dataset, so each is measured on its own, never pooled.
