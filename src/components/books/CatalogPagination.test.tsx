import assert from "node:assert/strict";
import { test } from "node:test";

import { load } from "cheerio";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

import { CatalogPagination, getPaginationItems, type CatalogPaginationLabels } from "./CatalogPagination";

const labels: CatalogPaginationLabels = {
  navigation: "Paginación del catálogo",
  previous: "Anterior",
  next: "Siguiente",
  previousPage: "Página anterior",
  nextPage: "Página siguiente",
  goToPage: (page) => `Ir a la página ${page}`,
  currentPage: (page) => `Página ${page}, página actual`,
  pageOf: (page, totalPages) => `Página ${page} de ${totalPages}`,
};

function render(page: number, totalPages: number, filters: { category?: string; query?: string } = {}) {
  return load(
    renderToStaticMarkup(
      <NextIntlClientProvider locale="es" messages={{}}>
        <CatalogPagination page={page} totalPages={totalPages} labels={labels} {...filters} />
      </NextIntlClientProvider>,
    ),
  );
}

test("page numbers show the ends and the neighbours of the current page, with an ellipsis per gap", () => {
  assert.deepEqual(getPaginationItems(1, 1), [1]);
  assert.deepEqual(getPaginationItems(1, 2), [1, 2]);
  assert.deepEqual(getPaginationItems(1, 5), [1, 2, "ellipsis", 5]);
  // A gap of one page shows that page instead of an ellipsis.
  assert.deepEqual(getPaginationItems(4, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(getPaginationItems(5, 10), [1, "ellipsis", 4, 5, 6, "ellipsis", 10]);
  assert.deepEqual(getPaginationItems(10, 10), [1, "ellipsis", 9, 10]);
});

test("a single page has no pagination", () => {
  assert.equal(render(1, 1)("nav").length, 0);
});

test("the first page links forward only; previous is plain text marked unavailable", () => {
  const $ = render(1, 3);
  const nav = $("nav");

  assert.equal(nav.attr("aria-label"), "Paginación del catálogo");
  assert.equal($('[aria-disabled="true"]').text(), "Anterior");
  assert.equal($('[aria-disabled="true"]').is("a"), false);
  assert.equal($('a[rel="next"]').attr("href"), "/es/books?page=2");
  assert.equal($('a[rel="next"]').attr("aria-label"), "Página siguiente");
  assert.equal($('a[rel="prev"]').length, 0);

  const current = $('[aria-current="page"]');
  assert.equal(current.text(), "1");
  assert.equal(current.is("a"), false);
  assert.equal(current.attr("aria-label"), "Página 1, página actual");
});

test("a middle page links both ways and to every page shown, never writing page 1", () => {
  const $ = render(2, 3);

  assert.equal($('a[rel="prev"]').attr("href"), "/es/books");
  assert.equal($('a[rel="next"]').attr("href"), "/es/books?page=3");
  assert.equal($('[aria-disabled="true"]').length, 0);
  assert.deepEqual(
    $("li a")
      .toArray()
      .map((element) => [$(element).attr("href"), $(element).attr("aria-label")]),
    [
      ["/es/books", "Ir a la página 1"],
      ["/es/books?page=3", "Ir a la página 3"],
    ],
  );
  assert.equal($("p").text(), "Página 2 de 3");
});

test("the last page links back only; next is plain text marked unavailable", () => {
  const $ = render(3, 3);

  assert.equal($('a[rel="next"]').length, 0);
  assert.equal($('[aria-disabled="true"]').text(), "Siguiente");
  assert.equal($('a[rel="prev"]').attr("href"), "/es/books?page=2");
});

test("every link keeps the category and the search", () => {
  const $ = render(2, 7, { category: "adventure", query: "isla del" });

  const hrefs = $("a")
    .toArray()
    .map((element) => $(element).attr("href"));
  assert.ok(hrefs.includes("/es/books?category=adventure&q=isla+del"));
  assert.ok(hrefs.includes("/es/books?category=adventure&q=isla+del&page=3"));
  assert.ok(hrefs.includes("/es/books?category=adventure&q=isla+del&page=7"));
  assert.ok(hrefs.every((href) => href?.startsWith("/es/books?category=adventure&q=isla+del")));
});

test("on narrow screens the page numbers are hidden and the position is text", () => {
  const $ = render(2, 3);

  assert.match($("ul").attr("class") ?? "", /(^| )hidden( |$)/);
  assert.match($("ul").attr("class") ?? "", /sm:flex/);
  assert.match($("p").attr("class") ?? "", /sm:hidden/);
});
