# Predicting “priority” from “subject,body”

> Multilingual Customer Support Tickets. Licence: CC-BY-NC-4.0 (the creator’s current Hugging Face release). Commercial use: no. Non-commercial: experiments only. Don’t assume the current version permits training a model for a product that’s sold. The tickets are synthetic, and the versions share thousands of tickets, so never pool them.

## The decision

Best: characters (tf-idf) + logistic regression, balanced accuracy 92% against 20% for always guessing the most common label. The data’s licence doesn’t allow commercial use, so no model is saved: this measures what’s possible, nothing more.

## The setup

13,178 texts, 5 labels, 5-fold stratified cross-validation. Character n-grams work across languages without a tokenizer.

## Results

| Method | Accuracy | Balanced accuracy | Macro F1 |
|---|---:|---:|---:|
| most common label | 28% | 20% | 0.09 |
| words (tf-idf) + logistic regression | 92% | 91% | 0.91 |
| characters (tf-idf) + logistic regression | 92% | 92% | 0.92 |

## Notes

- Source: dataset-tickets-german_normalized_50_5_2.csv (8,327,422 bytes, SHA-256 22580337aed864d8c0485f16a7fe683d48d8adfc3af0cd1a6fe1e240f728735f).
- 13,178 rows in the file; nothing removed; 13,178 measured.
- By language (characters (tf-idf) + logistic regression): de 92% of 13,178.
