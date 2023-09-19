export const timeSeriesTableHelper = () => {
  return `
  Use this transformation to convert time series results into a table, converting a time series data frame into a trend visualization field. A trend field can then be rendered using the [sparkline cell type](https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/table/#sparkline), producing an inline sparkline for each table row. If there are multiple time series queries, each will result in a separate table data frame. These can be joined using join or merge transforms to produce a single table with multiple sparklines per row.
  
  > **Note:** This transformation is available in Grafana 9.5+ as an opt-in beta feature. Modify Grafana [configuration file](/docs/grafana/latest/setup-grafana/configure-grafana/#configuration-file-location) to enable the 'timeSeriesTable' [feature toggle](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/feature-toggles/) to use it.
  `;
};
