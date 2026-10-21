# Predicting “priority” from “subject,body”

> Multilingual Customer Support Tickets. Licence: CC-BY-NC-4.0 (the creator’s current Hugging Face release). Commercial use: no. Non-commercial: experiments only. Don’t assume the current version permits training a model for a product that’s sold. The tickets are synthetic, and the versions share thousands of tickets, so never pool them.

## The decision

Best: words (tf-idf) + logistic regression, balanced accuracy 52% against 33% for always guessing the most common label. The data’s licence doesn’t allow commercial use, so no model is saved: this measures what’s possible, nothing more.

## The setup

20,000 texts, 3 labels, 5-fold stratified cross-validation. Character n-grams work across languages without a tokenizer.

## Results

| Method | Accuracy | Balanced accuracy | Macro F1 |
|---|---:|---:|---:|
| most common label | 41% | 33% | 0.19 |
| words (tf-idf) + logistic regression | 53% | 52% | 0.52 |
| characters (tf-idf) + logistic regression | 49% | 49% | 0.48 |

## Notes

- Source: dataset-tickets-multi-lang-4-20k.csv (18,799,808 bytes, SHA-256 9be3bf810584fe01e8e83383e83dfd33f4c3910938ecad03ef151da79d8f0635).
- 20,000 rows in the file; nothing removed; 20,000 measured.
- By language (words (tf-idf) + logistic regression): de 47% of 8,077, en 56% of 11,923.
- 8,308 of these tickets (42%) also appear in aa_dataset-tickets-multi-lang-5-2-50-version.csv: the files are versions of one dataset, so each is measured on its own, never pooled.
