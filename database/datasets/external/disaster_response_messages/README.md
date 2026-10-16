# External message corpus placement

The author-published Disaster Response Messages dataset is listed in
`../../metadata/external_sources.csv`; its three original split-file links are
in `../../metadata/external_files.csv`.

If you download it, place the files here with their original names:

- `disaster_response_training.csv`
- `disaster_response_validation.csv`
- `disaster_response_test.csv`

The author states that the 25,000-message dataset is CC BY 4.0 and that PII was
removed. Preserve attribution, review the source's privacy restrictions, and
keep these research messages separate from the ReliefGrid operational table
CSVs. They do not have the shelter, event, requester, stock, or allocation
fields needed for direct import into the project's PostgreSQL schema.
