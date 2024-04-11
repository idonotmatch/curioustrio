/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(() => {
var exports = {};
exports.id = "pages/_app";
exports.ids = ["pages/_app"];
exports.modules = {

/***/ "./pages/_app.js":
/*!***********************!*\
  !*** ./pages/_app.js ***!
  \***********************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (__WEBPACK_DEFAULT_EXPORT__)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _apollo_client__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @apollo/client */ \"@apollo/client\");\n/* harmony import */ var _apollo_client__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_apollo_client__WEBPACK_IMPORTED_MODULE_1__);\n/* harmony import */ var _styles_globals_css__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../styles/globals.css */ \"./styles/globals.css\");\n/* harmony import */ var _styles_globals_css__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_styles_globals_css__WEBPACK_IMPORTED_MODULE_2__);\n// pages/_app.js\n\n\n\n // Example of importing global styles, adjust the path as necessary\n\nvar client = new _apollo_client__WEBPACK_IMPORTED_MODULE_1__.ApolloClient({\n  link: new _apollo_client__WEBPACK_IMPORTED_MODULE_1__.HttpLink({\n    uri: '/api/graphql'\n  }),\n  // Assuming you have a Next.js API route set up for GraphQL\n  cache: new _apollo_client__WEBPACK_IMPORTED_MODULE_1__.InMemoryCache()\n});\nfunction MyApp(_ref) {\n  var Component = _ref.Component,\n    pageProps = _ref.pageProps;\n  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_apollo_client__WEBPACK_IMPORTED_MODULE_1__.ApolloProvider, {\n    client: client\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0___default().createElement(Component, pageProps));\n}\n/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (MyApp);//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiLi9wYWdlcy9fYXBwLmpzIiwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7QUFBQTtBQUMwQjtBQUNzQjtBQUN1QjtBQUN4QyxDQUFDOztBQUVoQyxJQUFNSyxNQUFNLEdBQUcsSUFBSUgsd0RBQVksQ0FBQztFQUM5QkksSUFBSSxFQUFFLElBQUlGLG9EQUFRLENBQUM7SUFBRUcsR0FBRyxFQUFFO0VBQWUsQ0FBQyxDQUFDO0VBQUU7RUFDN0NDLEtBQUssRUFBRSxJQUFJTCx5REFBYSxDQUFDO0FBQzNCLENBQUMsQ0FBQztBQUVGLFNBQVNNLEtBQUtBLENBQUFDLElBQUEsRUFBMkI7RUFBQSxJQUF4QkMsU0FBUyxHQUFBRCxJQUFBLENBQVRDLFNBQVM7SUFBRUMsU0FBUyxHQUFBRixJQUFBLENBQVRFLFNBQVM7RUFDbkMsb0JBQ0VaLDBEQUFBLENBQUNDLDBEQUFjO0lBQUNJLE1BQU0sRUFBRUE7RUFBTyxnQkFDN0JMLDBEQUFBLENBQUNXLFNBQVMsRUFBS0MsU0FBWSxDQUNiLENBQUM7QUFFckI7QUFFQSxpRUFBZUgsS0FBSyIsInNvdXJjZXMiOlsid2VicGFjazovL215LWdyYXBocWwtcHJvamVjdC8uL3BhZ2VzL19hcHAuanM/ZTBhZCJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBwYWdlcy9fYXBwLmpzXG5pbXBvcnQgUmVhY3QgZnJvbSAncmVhY3QnO1xuaW1wb3J0IHsgQXBvbGxvUHJvdmlkZXIgfSBmcm9tICdAYXBvbGxvL2NsaWVudCc7XG5pbXBvcnQgeyBBcG9sbG9DbGllbnQsIEluTWVtb3J5Q2FjaGUsIEh0dHBMaW5rIH0gZnJvbSAnQGFwb2xsby9jbGllbnQnO1xuaW1wb3J0ICcuLi9zdHlsZXMvZ2xvYmFscy5jc3MnOyAvLyBFeGFtcGxlIG9mIGltcG9ydGluZyBnbG9iYWwgc3R5bGVzLCBhZGp1c3QgdGhlIHBhdGggYXMgbmVjZXNzYXJ5XG5cbmNvbnN0IGNsaWVudCA9IG5ldyBBcG9sbG9DbGllbnQoe1xuICBsaW5rOiBuZXcgSHR0cExpbmsoeyB1cmk6ICcvYXBpL2dyYXBocWwnIH0pLCAvLyBBc3N1bWluZyB5b3UgaGF2ZSBhIE5leHQuanMgQVBJIHJvdXRlIHNldCB1cCBmb3IgR3JhcGhRTFxuICBjYWNoZTogbmV3IEluTWVtb3J5Q2FjaGUoKSxcbn0pO1xuXG5mdW5jdGlvbiBNeUFwcCh7IENvbXBvbmVudCwgcGFnZVByb3BzIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8QXBvbGxvUHJvdmlkZXIgY2xpZW50PXtjbGllbnR9PlxuICAgICAgPENvbXBvbmVudCB7Li4ucGFnZVByb3BzfSAvPlxuICAgIDwvQXBvbGxvUHJvdmlkZXI+XG4gICk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IE15QXBwO1xuIl0sIm5hbWVzIjpbIlJlYWN0IiwiQXBvbGxvUHJvdmlkZXIiLCJBcG9sbG9DbGllbnQiLCJJbk1lbW9yeUNhY2hlIiwiSHR0cExpbmsiLCJjbGllbnQiLCJsaW5rIiwidXJpIiwiY2FjaGUiLCJNeUFwcCIsIl9yZWYiLCJDb21wb25lbnQiLCJwYWdlUHJvcHMiLCJjcmVhdGVFbGVtZW50Il0sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///./pages/_app.js\n");

/***/ }),

/***/ "./styles/globals.css":
/*!****************************!*\
  !*** ./styles/globals.css ***!
  \****************************/
/***/ (() => {



/***/ }),

/***/ "@apollo/client":
/*!*********************************!*\
  !*** external "@apollo/client" ***!
  \*********************************/
/***/ ((module) => {

"use strict";
module.exports = require("@apollo/client");

/***/ }),

/***/ "react":
/*!************************!*\
  !*** external "react" ***!
  \************************/
/***/ ((module) => {

"use strict";
module.exports = require("react");

/***/ })

};
;

// load runtime
var __webpack_require__ = require("../webpack-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = (__webpack_exec__("./pages/_app.js"));
module.exports = __webpack_exports__;

})();