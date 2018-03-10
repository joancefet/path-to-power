import React from 'react';
import {bindActionCreators} from 'redux';
import {withRouter, Route, Switch} from 'react-router-dom';
import {connect} from 'react-redux';
import Yaml from 'js-yaml';

// Pages
import Page from '../page';
import PageNotFound from '../page/404';

import AuthContainer from '../auth';
import GameContainer from '../game';
import AccountContainer from '../account';

// Components
import Header from './header';
import {Container} from 'reactstrap';

// actions
import {socketConnect} from './actions';

class App extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            pages: [],
        };
    }

    componentWillMount() {
        this.getPages();
    }

    componentDidMount() {
        this.props.socketConnect();
    }

    onDispatch(data) {
        console.log(data);

        // if the dispatch has an ignore tag, and the user is defined within this tag, ignore the dispatch
        if (data.payload && data.payload.ignore) {
            if (this.props.character && data.payload.ignore.includes(this.props.character.user_id)) {
                return;
            }
        }

        // dispatch the action to redux store.
        this.props.dispatchServerAction(data);

        // if the request is a route change, do so here (temp. fix until we implement redux-router)
        if (data.payload.routeTo) {
            this.props.history.push(data.payload.routeTo);
        }
    }

    parsePageMeta(str) {
        if (str.slice(0, 3) !== '---') return;

        const matcher = /\n(\.{3}|-{3})/g;
        const metaEnd = matcher.exec(str);

        return metaEnd && [str.slice(0, metaEnd.index), str.slice(matcher.lastIndex)];
    }

    getPages() {
        const pages = [];
        const webpackRequireContext = require.context(
            '!raw-loader!../../pages',
            false,
            /\.md$/,
        );

        webpackRequireContext.keys().forEach((fileName) => {
            const file = webpackRequireContext(fileName);
            const page = {
                raw: file,
                meta: null,
                markdown: '',
            };

            if (! page.raw) return;

            const split = this.parsePageMeta(page.raw);
            if (split) {
                page.meta = Yaml.safeLoad(split[0]);
                page.markdown = split[1];
            }

            pages.push(page);
        });

        pages.sort((pageA, pageB) => {
            return (pageA.meta.path > pageB.meta.path) ? 1 : 0;
        });

        this.setState({pages});
    }

    renderGameRoute(component) {
        if (!this.props.isConnected) {
            return <p>Connecting...</p>;
        }

        return component;
    }

    render() {
        return (
            <React.Fragment>
                <Header pages={this.state.pages} />
                <main id="main">
                    <Container>
                        <Switch>
                            {
                                this.state.pages.map((page, index) => {
                                    return <Route exact path={'/' + page.meta.path} key={index} component={() => {
                                        return <Page page={page}/>;
                                    }} />;
                                })
                            }
                            <Route path="/auth" render={() => this.renderGameRoute(<AuthContainer/>)} />
                            <Route path="/game" render={() => this.renderGameRoute(<GameContainer/>)} />
                            <Route path="/account" render={() => this.renderGameRoute(<AccountContainer/>)} />
                            <Route component={PageNotFound} />
                        </Switch>
                    </Container>
                </main>
            </React.Fragment>
        );
    }
}

function mapDispatchToProps(dispatch) {
    return bindActionCreators({
        socketConnect,
    }, dispatch);
}

function mapStateToProps(state) {
    return {
        isConnected: state.app.connected,
        character: state.character.selected,
    };
}

export default withRouter(connect(mapStateToProps, mapDispatchToProps)(App));
