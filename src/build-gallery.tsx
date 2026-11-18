const captures = [
  {
    file: "postgresql-star-schema",
    title: "PostgreSQL star schema",
    detail:
      "The actual primary and foreign keys, read from PostgreSQL. Each fact lists the dimensions it references and its current row count.",
  },
  {
    file: "building-and-checking",
    title: "Building and checking the data",
    detail:
      "A walkthrough of the original SQL and a fresh run of the source-to-database checks. The checks reconcile totals and verify that a failed write rolls back.",
  },
  {
    file: "power-bi-sales",
    title: "Power BI · Sales",
    detail:
      "Power BI Desktop showing merchandise value by month and product category, based on the same reporting tables.",
  },
  {
    file: "power-bi-model",
    title: "Power BI · Model view",
    detail:
      "A close-up of the imported model showing how Payments, Dates, Customers, and Orders relate.",
  },
];

export function BuildGallery() {
  return (
    <>
      <div className="build-gallery">
        {captures.map(({ file, title, detail }) => {
          const source = `/build-gallery/${file}.jpg`;
          return (
            <figure key={file}>
              <a
                href={source}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open full-size screenshot: ${title}`}
              >
                <img
                  src={source}
                  alt={title}
                  loading={file === "postgresql-star-schema" ? "eager" : "lazy"}
                />
              </a>
              <figcaption>
                <h2>{title}</h2>
                <p>{detail}</p>
              </figcaption>
            </figure>
          );
        })}
      </div>
      <div className="gallery-actions">
        <a href="/downloads/data-dictionary.html">Data dictionary</a>
        <a href="https://github.com/bronson-12o/commerce-operations-explorer">
          SQL, tests, and report source
        </a>
        <a href="https://github.com/bronson-12o/commerce-operations-explorer/releases/download/v0.2.0/Commerce_Operations_Explorer.pbix">
          Download Power BI report
        </a>
      </div>
    </>
  );
}
